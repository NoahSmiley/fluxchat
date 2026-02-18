import SwiftUI

/// Renders the Flux logo: a ring/donut with two diagonal arrows (top-right and bottom-left).
/// Matches the desktop FluxLogo.tsx SVG exactly using the same path data.
/// Accepts a `size` parameter (default 40) and renders in the parent's foregroundStyle.
struct FluxLogoView: View {
    var size: CGFloat = 40

    /// Scale factor from the 100x100 viewBox to the requested size.
    private var scale: CGFloat { size / 100 }

    var body: some View {
        Canvas { context, canvasSize in
            let s = min(canvasSize.width, canvasSize.height) / 100

            // --- Ring (donut) using even-odd fill ---
            var ringPath = Path()
            // Outer circle: center (50,50), radius 24
            ringPath.addEllipse(in: CGRect(
                x: (50 - 24) * s,
                y: (50 - 24) * s,
                width: 48 * s,
                height: 48 * s
            ))
            // Inner circle: center (50,50), radius 14
            ringPath.addEllipse(in: CGRect(
                x: (50 - 14) * s,
                y: (50 - 14) * s,
                width: 28 * s,
                height: 28 * s
            ))
            context.fill(ringPath, with: .foreground, style: FillStyle(eoFill: true))

            // --- Top-right arrow line: (68,32) -> (80,20) ---
            var topLine = Path()
            topLine.move(to: CGPoint(x: 68 * s, y: 32 * s))
            topLine.addLine(to: CGPoint(x: 80 * s, y: 20 * s))
            context.stroke(topLine, with: .foreground, style: StrokeStyle(lineWidth: 3.5 * s, lineCap: .round))

            // --- Top-right arrowhead triangle: points="74,18 82,18 82,26" ---
            var topTriangle = Path()
            topTriangle.move(to: CGPoint(x: 74 * s, y: 18 * s))
            topTriangle.addLine(to: CGPoint(x: 82 * s, y: 18 * s))
            topTriangle.addLine(to: CGPoint(x: 82 * s, y: 26 * s))
            topTriangle.closeSubpath()
            context.fill(topTriangle, with: .foreground)

            // --- Bottom-left arrow line: (32,68) -> (20,80) ---
            var bottomLine = Path()
            bottomLine.move(to: CGPoint(x: 32 * s, y: 68 * s))
            bottomLine.addLine(to: CGPoint(x: 20 * s, y: 80 * s))
            context.stroke(bottomLine, with: .foreground, style: StrokeStyle(lineWidth: 3.5 * s, lineCap: .round))

            // --- Bottom-left arrowhead triangle: points="18,74 18,82 26,82" ---
            var bottomTriangle = Path()
            bottomTriangle.move(to: CGPoint(x: 18 * s, y: 74 * s))
            bottomTriangle.addLine(to: CGPoint(x: 18 * s, y: 82 * s))
            bottomTriangle.addLine(to: CGPoint(x: 26 * s, y: 82 * s))
            bottomTriangle.closeSubpath()
            context.fill(bottomTriangle, with: .foreground)
        }
        .frame(width: size, height: size)
    }
}

#Preview {
    ZStack {
        Color(red: 0.039, green: 0.039, blue: 0.039)
            .ignoresSafeArea()

        VStack(spacing: 24) {
            FluxLogoView(size: 24)
            FluxLogoView(size: 40)
            FluxLogoView(size: 80)
        }
        .foregroundStyle(.white)
    }
}
