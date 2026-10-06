import Foundation

struct DailySnapshot: Codable, Sendable {
    let formatVersion: Int
    let generatedAt: String
    let slateDate: String
    let timezone: String
    let universeSize: Int
    let tradersWithOpenData: Int
    let tradersWithHistoryData: Int
    let methodology: String
    let picks: [DailyPick]
    let traders: [TraderSnapshot]
}

struct DailyPick: Codable, Identifiable, Sendable {
    let rank: Int
    let conditionId: String
    let title: String
    let slug: String
    let eventSlug: String
    let outcome: String
    let price: Double?
    let score: Double
    let consensus: Double
    let consensusWallets: Int
    let trackedValue: Double
    let endDate: String?
    let marketURL: String
    let supportingTraders: [SupportingTrader]
    let rationale: String

    var id: String { conditionId }
}

struct SupportingTrader: Codable, Identifiable, Sendable {
    let name: String
    let wallet: String
    let score: Double

    var id: String { wallet.lowercased() }
}

struct TraderSnapshot: Codable, Identifiable, Sendable {
    let rank: Int
    let pnlRank: Int
    let wallet: String
    let name: String
    let pnl: Double
    let volume: Double
    let score: Double
    let winRate: Double?
    let wins: Int
    let losses: Int
    let closedPositionsSampled: Int
    let activePositionCount: Int
    let profileImage: String
    let activePositions: [PositionSnapshot]
    let recentResults: [PastTradeSnapshot]
    let positionsFetched: Bool
    let historyFetched: Bool

    var id: String { wallet.lowercased() }
}

struct PositionSnapshot: Codable, Identifiable, Sendable {
    let conditionId: String
    let title: String
    let slug: String
    let eventSlug: String
    let outcome: String
    let averagePrice: Double?
    let currentPrice: Double?
    let currentValue: Double
    let size: Double
    let cashPnl: Double
    let endDate: String?

    var id: String { "\(conditionId)-\(outcome)-\(slug)" }
}

struct PastTradeSnapshot: Codable, Identifiable, Sendable {
    let title: String
    let slug: String
    let outcome: String
    let realizedPnl: Double
    let closedAt: String?

    var id: String { "\(slug)-\(closedAt ?? title)" }
}
