import Foundation
import Observation

@Observable
@MainActor
final class AppStore {
    private(set) var snapshot: DailySnapshot?
    private(set) var isRefreshing = false
    private(set) var hasLoaded = false
    var errorMessage: String?

    var isSnapshotCurrent: Bool {
        snapshot?.slateDate == AppConfiguration.currentSlateDate
    }

    private let cacheURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
        .first?.appendingPathComponent("signal-slate-daily-picks.json")

    init(previewSnapshot: DailySnapshot? = nil) {
        if let previewSnapshot {
            snapshot = previewSnapshot
            hasLoaded = true
            return
        }
        if let cacheURL,
           let data = try? Data(contentsOf: cacheURL),
           let cached = try? JSONDecoder().decode(DailySnapshot.self, from: data) {
            snapshot = cached
        }
    }

    func refresh() async {
        guard !isRefreshing else { return }
        guard let url = AppConfiguration.snapshotURL else {
            errorMessage = "Set a valid daily snapshot URL in Settings."
            hasLoaded = true
            return
        }

        isRefreshing = true
        defer {
            isRefreshing = false
            hasLoaded = true
        }

        do {
            var request = URLRequest(url: url)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            request.timeoutInterval = 25
            request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
            let (data, urlResponse) = try await URLSession.shared.data(for: request)
            guard let response = urlResponse as? HTTPURLResponse,
                  (200..<300).contains(response.statusCode) else {
                let status = (urlResponse as? HTTPURLResponse)?.statusCode ?? 0
                throw SnapshotError.badStatus(status)
            }

            let latest = try JSONDecoder().decode(DailySnapshot.self, from: data)
            guard latest.formatVersion == 1 else { throw SnapshotError.unsupportedVersion }
            snapshot = latest
            if let cacheURL {
                try? FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? data.write(to: cacheURL, options: .atomic)
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

enum SnapshotError: LocalizedError {
    case badStatus(Int)
    case unsupportedVersion

    var errorDescription: String? {
        switch self {
        case .badStatus(let code):
            return code == 0
                ? "The daily feed did not return a response. Your last saved snapshot is still available."
                : "The daily feed returned HTTP \(code). Your last saved snapshot is still available."
        case .unsupportedVersion:
            return "This daily feed uses a format this app version does not support."
        }
    }
}

enum AppConfiguration {
    static let feedPreferenceKey = "signalSlate.snapshotFeedURL"
    static let bundledFeedURL = Bundle.main.object(forInfoDictionaryKey: "PolymarketSnapshotURL") as? String
        ?? "https://raw.githubusercontent.com/replace-me/replace-me/main/docs/daily-picks.json"

    static var currentSlateDate: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "America/New_York")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    static var snapshotURL: URL? {
        let preferred = UserDefaults.standard.string(forKey: feedPreferenceKey)
        let value = (preferred?.isEmpty == false ? preferred : bundledFeedURL)?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value, !value.contains("replace-me"), let url = URL(string: value),
              url.scheme == "https", url.host != nil else { return nil }
        return url
    }
}
