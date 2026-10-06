import SwiftUI

@main
struct PolymarketEdgeApp: App {
    @State private var store = AppStore()

    var body: some Scene {
        WindowGroup {
            MainTabView()
                .environment(store)
                .preferredColorScheme(.dark)
                .tint(AppColors.lime)
        }
    }
}

enum AppColors {
    static let background = Color(red: 0.035, green: 0.055, blue: 0.075)
    static let surface = Color(red: 0.075, green: 0.10, blue: 0.13)
    static let raised = Color(red: 0.105, green: 0.14, blue: 0.17)
    static let lime = Color(red: 0.75, green: 0.96, blue: 0.35)
    static let mint = Color(red: 0.36, green: 0.88, blue: 0.70)
    static let muted = Color(red: 0.58, green: 0.65, blue: 0.70)
    static let line = Color.white.opacity(0.09)
    static let loss = Color(red: 1.0, green: 0.43, blue: 0.40)
}

enum DisplayFormat {
    static func money(_ value: Double, currency: Bool = true) -> String {
        let number = abs(value)
        let sign = value < 0 ? "−" : ""
        let formatted: String
        if number >= 1_000_000_000 {
            formatted = String(format: "%.1fB", number / 1_000_000_000)
        } else if number >= 1_000_000 {
            formatted = String(format: "%.1fM", number / 1_000_000)
        } else if number >= 10_000 {
            formatted = String(format: "%.0fK", number / 1_000)
        } else {
            formatted = String(format: "%.0f", number)
        }
        return "\(sign)\(currency ? "$" : "")\(formatted)"
    }

    static func percent(_ value: Double?) -> String {
        guard let value else { return "—" }
        return String(format: "%.0f%%", value)
    }

    static func date(_ value: String, format: String = "EEEE, MMM d") -> String {
        let input = ISO8601DateFormatter()
        input.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = input.date(from: value) ?? ISO8601DateFormatter().date(from: value)
        guard let date else { return value }
        let formatter = DateFormatter()
        formatter.timeZone = TimeZone(identifier: "America/New_York")
        formatter.dateFormat = format
        return formatter.string(from: date)
    }

    static func slateDate(_ value: String) -> String {
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.timeZone = TimeZone(secondsFromGMT: 0)
        input.dateFormat = "yyyy-MM-dd"
        guard let date = input.date(from: value) else { return value }
        let output = DateFormatter()
        output.timeZone = TimeZone(secondsFromGMT: 0)
        output.dateFormat = "EEEE, MMM d"
        return output.string(from: date)
    }

    static func relativeDate(_ value: String?) -> String {
        guard let value else { return "Recent" }
        return date(value, format: "MMM d")
    }
}
