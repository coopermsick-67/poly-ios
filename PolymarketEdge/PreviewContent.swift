import SwiftUI

enum PreviewContent {
    static let trader = TraderSnapshot(
        rank: 1,
        pnlRank: 4,
        wallet: "0x204f72f35326db932158cba6adff0b9a1da95e14",
        name: "swisstony",
        pnl: 18420270.76,
        volume: 1850584186.30,
        score: 94.2,
        winRate: 67.5,
        wins: 27,
        losses: 13,
        closedPositionsSampled: 40,
        activePositionCount: 18,
        profileImage: "",
        activePositions: [
            PositionSnapshot(
                conditionId: "preview-condition-1",
                title: "Seattle Seahawks to beat Arizona Cardinals",
                slug: "nfl-sea-ari-2026-10-06",
                eventSlug: "nfl-sea-ari-2026-10-06",
                outcome: "Seattle Seahawks",
                averagePrice: 0.58,
                currentPrice: 0.64,
                currentValue: 12450,
                size: 19453,
                cashPnl: 1167,
                endDate: "2026-10-07"
            )
        ],
        recentResults: [
            PastTradeSnapshot(title: "Cincinnati Bengals vs. Pittsburgh Steelers", slug: "nfl-cin-pit", outcome: "Cincinnati Bengals", realizedPnl: 820, closedAt: "2026-10-04T20:00:00Z"),
            PastTradeSnapshot(title: "Chicago Cubs to win", slug: "mlb-chc", outcome: "Yes", realizedPnl: -210, closedAt: "2026-10-02T20:00:00Z")
        ],
        positionsFetched: true,
        historyFetched: true
    )

    static let snapshot = DailySnapshot(
        formatVersion: 1,
        generatedAt: "2026-10-06T14:00:00.000Z",
        slateDate: "2026-10-06",
        timezone: "America/New_York",
        universeSize: 1000,
        tradersWithOpenData: 996,
        tradersWithHistoryData: 998,
        methodology: "Preview data only.",
        picks: [
            DailyPick(
                rank: 1,
                conditionId: "preview-condition-1",
                title: "Seattle Seahawks to beat Arizona Cardinals",
                slug: "nfl-sea-ari-2026-10-06",
                eventSlug: "nfl-sea-ari-2026-10-06",
                outcome: "Seattle Seahawks",
                price: 0.64,
                score: 89,
                consensus: 81,
                consensusWallets: 12,
                trackedValue: 82340,
                endDate: "2026-10-07T00:20:00Z",
                marketURL: "https://polymarket.com/event/nfl-sea-ari-2026-10-06",
                supportingTraders: [
                    SupportingTrader(name: "swisstony", wallet: "0x204f72f35326db932158cba6adff0b9a1da95e14", score: 94.2),
                    SupportingTrader(name: "RN1", wallet: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea", score: 88.1),
                    SupportingTrader(name: "mintblade", wallet: "0x96cfcb0c30942cfcd1cdf76c7d408794d66b1acb", score: 84.5)
                ],
                rationale: "12 tracked top-1,000 sports wallets hold Seattle; their score-weighted support is 81%."
            )
        ],
        traders: [trader]
    )
}

#Preview("Today") {
    TodayView()
        .environment(AppStore(previewSnapshot: PreviewContent.snapshot))
        .preferredColorScheme(.dark)
}

#Preview("Traders") {
    TradersView()
        .environment(AppStore(previewSnapshot: PreviewContent.snapshot))
        .preferredColorScheme(.dark)
}

#Preview("Trader details") {
    NavigationStack {
        TraderDetailView(trader: PreviewContent.trader)
    }
    .preferredColorScheme(.dark)
}
