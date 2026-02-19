import Foundation

@Observable
final class FluxWebSocket {

    // MARK: - Connection State

    enum ConnectionState: String {
        case disconnected
        case connecting
        case connected
    }

    private(set) var state: ConnectionState = .disconnected

    // MARK: - Private Properties

    private var webSocketTask: URLSessionWebSocketTask?
    private var heartbeatTask: Task<Void, Never>?
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempt = 0
    private var token: String?
    private var intentionalDisconnect = false

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

    private let encoder = JSONEncoder()
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    // MARK: - Event Stream

    @ObservationIgnored
    private var eventContinuation: AsyncStream<WSServerEvent>.Continuation?

    /// An `AsyncStream` that yields every `WSServerEvent` received from the
    /// gateway. Consumers (e.g. `EventRouter`) iterate over this stream.
    @ObservationIgnored
    private(set) var events: AsyncStream<WSServerEvent>!

    init() {
        events = AsyncStream { [weak self] continuation in
            self?.eventContinuation = continuation
        }
    }

    // MARK: - Public API

    /// Open a WebSocket connection to the gateway, authenticating with the
    /// given session token.
    func connect(token: String) {
        guard state == .disconnected else { return }

        self.token = token
        self.intentionalDisconnect = false
        state = .connecting

        guard let url = URL(string: Config.gatewayURL + "?token=\(token)") else {
            print("[FluxWebSocket] Invalid gateway URL")
            state = .disconnected
            return
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 10

        let task = session.webSocketTask(with: request)
        self.webSocketTask = task
        task.resume()

        state = .connected
        reconnectAttempt = 0

        startReceiveLoop()
        startHeartbeat()
    }

    /// Gracefully close the connection. No automatic reconnect will be
    /// attempted.
    func disconnect() {
        intentionalDisconnect = true
        tearDown()
        state = .disconnected
    }

    /// Send a client event over the WebSocket.
    func send(_ event: WSClientEvent) {
        guard state == .connected else { return }

        do {
            let data = try encoder.encode(event)
            guard let json = String(data: data, encoding: .utf8) else { return }
            webSocketTask?.send(.string(json)) { error in
                if let error {
                    print("[FluxWebSocket] Send error: \(error.localizedDescription)")
                }
            }
        } catch {
            print("[FluxWebSocket] Encode error: \(error.localizedDescription)")
        }
    }

    // MARK: - Receive Loop

    private func startReceiveLoop() {
        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            guard let self else { return }
            await self.receiveLoop()
        }
    }

    private func receiveLoop() async {
        while !Task.isCancelled {
            guard let task = webSocketTask else { break }

            do {
                let message = try await task.receive()

                switch message {
                case .string(let text):
                    handleText(text)
                case .data(let data):
                    handleData(data)
                @unknown default:
                    break
                }
            } catch {
                // Receive failed -- connection dropped.
                if !Task.isCancelled && !intentionalDisconnect {
                    print("[FluxWebSocket] Receive error: \(error.localizedDescription)")
                    await handleConnectionLost()
                }
                break
            }
        }
    }

    private func handleText(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        handleData(data)
    }

    private func handleData(_ data: Data) {
        do {
            let event = try decoder.decode(WSServerEvent.self, from: data)
            eventContinuation?.yield(event)
        } catch {
            print("[FluxWebSocket] Decode error: \(error.localizedDescription)")
        }
    }

    // MARK: - Heartbeat

    private func startHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(Config.wsHeartbeatInterval))
                guard !Task.isCancelled else { break }
                self.send(.ping)
            }
        }
    }

    // MARK: - Reconnection

    private func handleConnectionLost() async {
        tearDown()
        state = .disconnected

        guard !intentionalDisconnect else { return }
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self, let token = self.token else { return }

            let delay = min(
                Config.wsReconnectBaseDelay * pow(2.0, Double(reconnectAttempt)),
                Config.wsReconnectMaxDelay
            )
            reconnectAttempt += 1

            print("[FluxWebSocket] Reconnecting in \(delay)s (attempt \(reconnectAttempt))")

            try? await Task.sleep(for: .seconds(delay))

            guard !Task.isCancelled, !self.intentionalDisconnect else { return }

            self.connect(token: token)
        }
    }

    // MARK: - Tear Down

    private func tearDown() {
        heartbeatTask?.cancel()
        heartbeatTask = nil

        receiveTask?.cancel()
        receiveTask = nil

        reconnectTask?.cancel()
        reconnectTask = nil

        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
    }

    deinit {
        intentionalDisconnect = true
        tearDown()
        eventContinuation?.finish()
    }
}
