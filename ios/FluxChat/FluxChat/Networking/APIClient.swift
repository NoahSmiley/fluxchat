import Foundation

// MARK: - API Errors

enum APIError: LocalizedError {
    case unauthorized
    case forbidden
    case notFound
    case badRequest(String)
    case serverError(String)

    var errorDescription: String? {
        switch self {
        case .unauthorized:
            return "Unauthorized"
        case .forbidden:
            return "Forbidden"
        case .notFound:
            return "Not found"
        case .badRequest(let message):
            return message
        case .serverError(let message):
            return message
        }
    }
}

// MARK: - API Client

final class APIClient: @unchecked Sendable {
    static let shared = APIClient()

    private let session: URLSession
    private let baseURL: String
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config)
        self.baseURL = Config.apiBase
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
    }

    // MARK: - Token management

    private var bearerToken: String? {
        KeychainHelper.get(Config.sessionTokenKey)
    }

    // MARK: - JSON request with Decodable response

    func request<T: Decodable>(
        _ method: String,
        _ path: String,
        body: (any Encodable)? = nil
    ) async throws -> T {
        let data = try await performRequest(method, path, body: body)
        return try decoder.decode(T.self, from: data)
    }

    // MARK: - Void request (ignores response body)

    func requestVoid(
        _ method: String,
        _ path: String,
        body: (any Encodable)? = nil
    ) async throws {
        _ = try await performRequest(method, path, body: body)
    }

    // MARK: - Multipart file upload

    func upload<T: Decodable>(
        _ path: String,
        fileData: Data,
        filename: String,
        contentType: String
    ) async throws -> T {
        let boundary = UUID().uuidString
        var urlRequest = makeURLRequest(path)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )

        var bodyData = Data()
        // File part
        bodyData.append("--\(boundary)\r\n")
        bodyData.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n")
        bodyData.append("Content-Type: \(contentType)\r\n\r\n")
        bodyData.append(fileData)
        bodyData.append("\r\n")
        // Closing boundary
        bodyData.append("--\(boundary)--\r\n")

        urlRequest.httpBody = bodyData

        let (data, response) = try await session.data(for: urlRequest)
        try validateResponse(response, data: data)
        return try decoder.decode(T.self, from: data)
    }

    // MARK: - Internal helpers

    private func performRequest(
        _ method: String,
        _ path: String,
        body: (any Encodable)? = nil
    ) async throws -> Data {
        var urlRequest = makeURLRequest(path)
        urlRequest.httpMethod = method

        if let body {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            urlRequest.httpBody = try encoder.encode(AnyEncodable(body))
        }

        let (data, response) = try await session.data(for: urlRequest)
        try validateResponse(response, data: data)
        return data
    }

    private func makeURLRequest(_ path: String) -> URLRequest {
        let url = URL(string: "\(baseURL)\(path)")!
        var request = URLRequest(url: url)
        if let token = bearerToken {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func validateResponse(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid response")
        }

        guard (200...299).contains(http.statusCode) else {
            let message = extractErrorMessage(from: data) ?? "Request failed with status \(http.statusCode)"
            switch http.statusCode {
            case 401:
                throw APIError.unauthorized
            case 403:
                throw APIError.forbidden
            case 404:
                throw APIError.notFound
            case 400:
                throw APIError.badRequest(message)
            default:
                throw APIError.serverError(message)
            }
        }
    }

    private func extractErrorMessage(from data: Data) -> String? {
        struct ErrorBody: Decodable {
            let error: String?
        }
        return try? decoder.decode(ErrorBody.self, from: data).error
    }
}

// MARK: - Type-erased Encodable wrapper

private struct AnyEncodable: Encodable {
    private let _encode: (Encoder) throws -> Void

    init(_ value: any Encodable) {
        self._encode = { encoder in
            try value.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try _encode(encoder)
    }
}

// MARK: - Data + string append helper

private extension Data {
    mutating func append(_ string: String) {
        if let data = string.data(using: .utf8) {
            append(data)
        }
    }
}
