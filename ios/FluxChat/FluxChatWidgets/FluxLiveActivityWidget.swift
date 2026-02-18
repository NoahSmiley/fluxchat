import ActivityKit
import SwiftUI
import WidgetKit

/// The Live Activity widget that renders the Flux logo in the Dynamic Island.
struct FluxLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: FluxActivityAttributes.self) { context in
            // Lock screen / banner view
            HStack {
                fluxLogo(size: 24)
                Text("Flux")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(Color(red: 0.039, green: 0.039, blue: 0.039))
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded view
                DynamicIslandExpandedRegion(.center) {
                    HStack(spacing: 8) {
                        fluxLogo(size: 28)
                        Text("Flux")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                }
            } compactLeading: {
                fluxLogo(size: 16)
            } compactTrailing: {
                // Empty or small indicator
                Circle()
                    .fill(.green)
                    .frame(width: 6, height: 6)
            } minimal: {
                // Minimal: just the logo
                fluxLogo(size: 16)
            }
        }
    }

    /// Renders the Flux logo using Canvas (same as FluxLogoView but inline for widget).
    private func fluxLogo(size: CGFloat) -> some View {
        Canvas { context, canvasSize in
            let s = min(canvasSize.width, canvasSize.height) / 100

            // Ring (donut)
            var ringPath = Path()
            ringPath.addEllipse(in: CGRect(x: (50-24)*s, y: (50-24)*s, width: 48*s, height: 48*s))
            ringPath.addEllipse(in: CGRect(x: (50-14)*s, y: (50-14)*s, width: 28*s, height: 28*s))
            context.fill(ringPath, with: .color(.white), style: FillStyle(eoFill: true))

            // Top-right arrow
            var topLine = Path()
            topLine.move(to: CGPoint(x: 68*s, y: 32*s))
            topLine.addLine(to: CGPoint(x: 80*s, y: 20*s))
            context.stroke(topLine, with: .color(.white), style: StrokeStyle(lineWidth: 3.5*s, lineCap: .round))

            var topTri = Path()
            topTri.move(to: CGPoint(x: 74*s, y: 18*s))
            topTri.addLine(to: CGPoint(x: 82*s, y: 18*s))
            topTri.addLine(to: CGPoint(x: 82*s, y: 26*s))
            topTri.closeSubpath()
            context.fill(topTri, with: .color(.white))

            // Bottom-left arrow
            var botLine = Path()
            botLine.move(to: CGPoint(x: 32*s, y: 68*s))
            botLine.addLine(to: CGPoint(x: 20*s, y: 80*s))
            context.stroke(botLine, with: .color(.white), style: StrokeStyle(lineWidth: 3.5*s, lineCap: .round))

            var botTri = Path()
            botTri.move(to: CGPoint(x: 18*s, y: 74*s))
            botTri.addLine(to: CGPoint(x: 18*s, y: 82*s))
            botTri.addLine(to: CGPoint(x: 26*s, y: 82*s))
            botTri.closeSubpath()
            context.fill(botTri, with: .color(.white))
        }
        .frame(width: size, height: size)
    }
}
