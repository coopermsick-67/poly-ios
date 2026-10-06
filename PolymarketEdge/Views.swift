import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label("Today", systemImage: "sun.max.fill") }
            TradersView()
                .tabItem { Label("Traders", systemImage: "person.3.fill") }
            MethodologyView()
                .tabItem { Label("How it works", systemImage: "chart.xyaxis.line") }
        }
        .background(AppColors.background)
    }
}

struct TodayView: View {
    @Environment(AppStore.self) private var store
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    titleBlock
                    snapshotStatus
                    summaryStrip
                    picksSection
                    responsiblePlayNote
                }
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 28)
            }
            .background(AppColors.background.ignoresSafeArea())
            .refreshable { await store.refresh() }
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showingSettings) { FeedSettingsView() }
            .task {
                if !store.hasLoaded { await store.refresh() }
            }
        }
    }

    private var titleBlock: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Circle().fill(AppColors.lime).frame(width: 8, height: 8)
                    Text("SPORTS MARKET INTELLIGENCE")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .tracking(1.35)
            .foregroundStyle(AppColors.muted)
                }
                Text("Signal Slate")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .tracking(-1.2)
                    .foregroundStyle(.white)
                Text(store.snapshot.map { DisplayFormat.slateDate($0.slateDate) } ?? "Today’s top trader signals")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(AppColors.muted)
            }
            Spacer(minLength: 0)
            Button {
                showingSettings = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 42)
                    .background(AppColors.surface, in: Circle())
                    .overlay(Circle().stroke(AppColors.line, lineWidth: 1))
            }
            .accessibilityLabel("Feed settings")
        }
    }

    @ViewBuilder
    private var snapshotStatus: some View {
        if store.isRefreshing {
            HStack(spacing: 10) {
                ProgressView().tint(AppColors.lime)
                Text(store.snapshot == nil ? "Loading today’s market snapshot…" : "Checking for today’s latest snapshot…")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AppColors.muted)
                Spacer()
            }
            .padding(13)
            .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 14))
        } else if let message = store.errorMessage {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: store.snapshot == nil ? "wifi.exclamationmark" : "clock.arrow.circlepath")
                    .foregroundStyle(AppColors.lime)
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.snapshot == nil ? "Daily feed not connected" : "Showing the saved snapshot")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(store.snapshot == nil ? "Add the public feed URL in settings, then pull down to refresh." : message)
                        .font(.system(size: 11))
                        .foregroundStyle(AppColors.muted)
                }
                Spacer(minLength: 0)
            }
            .padding(13)
            .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 14))
        } else if let snapshot = store.snapshot {
            HStack(spacing: 8) {
                Image(systemName: "arrow.clockwise.circle.fill")
                    .foregroundStyle(AppColors.mint)
                Text("\(store.isSnapshotCurrent ? "Updated" : "Last slate · updated") \(DisplayFormat.date(snapshot.generatedAt, format: "h:mm a 'ET'"))")
                    .foregroundStyle(AppColors.muted)
                Spacer()
                Text(store.isSnapshotCurrent
                     ? (snapshot.universeSize == 1000 ? "1,000 WALLETS" : "\(snapshot.universeSize) WALLETS")
                     : "STALE SLATE")
                    .font(.system(size: 9, weight: .bold))
                    .tracking(0.9)
                    .foregroundStyle(AppColors.lime)
            }
            .font(.system(size: 11, weight: .medium))
        }
    }

    private var summaryStrip: some View {
        HStack(spacing: 10) {
            SummaryTile(value: "\(store.snapshot?.universeSize ?? 0)", label: "TRADERS SCORED", icon: "person.3")
            SummaryTile(value: "\(store.snapshot?.picks.count ?? 0)", label: "TODAY’S SIGNALS", icon: "scope")
            SummaryTile(value: "\(store.snapshot?.tradersWithHistoryData ?? 0)", label: "HISTORY CHECKED", icon: "clock.arrow.circlepath")
        }
    }

    private var picksSection: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(alignment: .lastTextBaseline) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.isSnapshotCurrent ? "Today’s signal card" : "Latest published slate")
                        .font(.system(size: 20, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("Crowd positions from the highest-scoring sports wallets")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(AppColors.muted)
                }
                Spacer()
                if store.snapshot?.picks.isEmpty == false {
                    Text("TOP 3")
                        .font(.system(size: 9, weight: .heavy))
                        .tracking(1)
                        .foregroundStyle(AppColors.lime)
                }
            }

            if let picks = store.snapshot?.picks, !picks.isEmpty {
                ForEach(picks.prefix(3)) { pick in
                    PickCard(pick: pick)
                }
            } else if store.isRefreshing {
                EmptyPicksCard(title: "Finding today’s consensus", detail: "The daily feed is loading from Polymarket’s public data.")
            } else if store.snapshot?.universeSize == 0 {
                EmptyPicksCard(title: "Snapshot is warming up", detail: "Run the daily snapshot workflow once to populate the first slate.")
            } else {
                EmptyPicksCard(title: "No qualified picks yet", detail: "No market passed the minimum consensus rule for this slate. Pull down to check again later.")
            }
        }
    }

    private var responsiblePlayNote: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "info.circle.fill")
                .foregroundStyle(AppColors.lime)
            Text("Signals reflect tracked wallet positions at snapshot time. Prices move, positions can change, and a trader’s past results do not guarantee future outcomes. Review each market before making a decision.")
                .font(.system(size: 11, weight: .medium))
                .lineSpacing(3)
                .foregroundStyle(AppColors.muted)
        }
        .padding(.top, 2)
    }
}

struct SummaryTile: View {
    let value: String
    let label: String
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(AppColors.lime)
            Text(value)
                .font(.system(size: 21, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.75)
                .lineLimit(1)
            Text(label)
                .font(.system(size: 8, weight: .bold, design: .rounded))
                .tracking(0.7)
                .foregroundStyle(AppColors.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(AppColors.line, lineWidth: 1))
    }
}

struct PickCard: View {
    let pick: DailyPick

    private var priceText: String {
        guard let price = pick.price else { return "—" }
        return String(format: "%.0f¢", price * 100)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 10) {
                Text(String(format: "%02d", pick.rank))
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(AppColors.lime)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(AppColors.lime.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 5) {
                    Text(pick.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("\(pick.outcome)  ·  \(pick.consensusWallets) tracked wallets")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(AppColors.mint)
                    if let endDate = pick.endDate {
                        Text("Starts \(DisplayFormat.date(endDate, format: "h:mm a 'ET'"))")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(AppColors.muted)
                    }
                }
                Spacer(minLength: 4)
                ScoreBadge(score: pick.score, compact: true)
            }

            HStack(spacing: 0) {
                MetricValue(title: "SIGNAL SCORE", value: String(format: "%.0f", pick.score), suffix: "/100")
                Spacer()
                MetricValue(title: "WALLET SUPPORT", value: String(format: "%.0f%%", pick.consensus), suffix: "")
                Spacer()
                MetricValue(title: "MARKET PRICE", value: priceText, suffix: "")
            }

            Text(pick.rationale)
                .font(.system(size: 11, weight: .medium))
                .lineSpacing(2)
                .foregroundStyle(AppColors.muted)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 7) {
                ForEach(pick.supportingTraders.prefix(3)) { trader in
                    Text(trader.name)
                        .font(.system(size: 9, weight: .semibold))
                        .lineLimit(1)
                        .foregroundStyle(.white.opacity(0.86))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(AppColors.raised, in: Capsule())
                }
                Spacer(minLength: 4)
                if let url = URL(string: pick.marketURL) {
                    Link(destination: url) {
                        HStack(spacing: 5) {
                            Text("View market")
                            Image(systemName: "arrow.up.right")
                        }
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(AppColors.lime)
                    }
                }
            }
        }
        .padding(15)
        .background(
            LinearGradient(colors: [AppColors.surface, AppColors.raised.opacity(0.86)], startPoint: .topLeading, endPoint: .bottomTrailing),
            in: RoundedRectangle(cornerRadius: 18)
        )
        .overlay(RoundedRectangle(cornerRadius: 18).stroke(AppColors.line, lineWidth: 1))
    }
}

struct MetricValue: View {
    let title: String
    let value: String
    let suffix: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 8, weight: .bold))
                .tracking(0.65)
                .foregroundStyle(AppColors.muted)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                if !suffix.isEmpty {
                    Text(suffix)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(AppColors.muted)
                }
            }
        }
    }
}

struct ScoreBadge: View {
    let score: Double
    var compact = false

    var body: some View {
        VStack(spacing: 1) {
            Text(String(format: "%.1f", score))
                .font(.system(size: compact ? 15 : 22, weight: .bold, design: .rounded))
            if !compact {
                Text("SCORE")
                    .font(.system(size: 8, weight: .heavy))
                    .tracking(0.8)
            }
        }
        .foregroundStyle(AppColors.lime)
        .frame(minWidth: compact ? 39 : 56, minHeight: compact ? 36 : 52)
        .background(AppColors.lime.opacity(0.11), in: RoundedRectangle(cornerRadius: 11))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(AppColors.lime.opacity(0.2), lineWidth: 1))
    }
}

struct EmptyPicksCard: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "scope")
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(AppColors.lime)
                .padding(.bottom, 2)
            Text(title)
                .font(.system(size: 15, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
            Text(detail)
                .font(.system(size: 11, weight: .medium))
                .lineSpacing(2)
                .foregroundStyle(AppColors.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 17))
        .overlay(RoundedRectangle(cornerRadius: 17).stroke(AppColors.line, lineWidth: 1))
    }
}

struct TradersView: View {
    @Environment(AppStore.self) private var store
    @State private var searchText = ""

    private var traders: [TraderSnapshot] {
        let all = store.snapshot?.traders ?? []
        guard !searchText.isEmpty else { return all }
        return all.filter {
            $0.name.localizedCaseInsensitiveContains(searchText)
                || $0.wallet.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Trader board")
                            .font(.system(size: 30, weight: .bold, design: .rounded))
                            .tracking(-0.8)
                            .foregroundStyle(.white)
                        Text("Ranked by a blended score across 1,000 all-time sports wallets.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(AppColors.muted)
                    }
                    .padding(.top, 16)

                    Link(destination: URL(string: "https://signal-slate.coopdogg67.chatgpt.site/#wallet-scan")!) {
                        HStack(spacing: 9) {
                            Image(systemName: "doc.text.magnifyingglass")
                            Text("Import TXT & scan up to 2,000 wallets")
                            Spacer(minLength: 4)
                            Image(systemName: "arrow.up.right")
                        }
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(AppColors.lime)
                        .padding(12)
                        .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppColors.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)

                    HStack(spacing: 9) {
                        Image(systemName: "magnifyingglass").foregroundStyle(AppColors.muted)
                        TextField("Search name or wallet", text: $searchText)
                            .font(.system(size: 13))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    .padding(12)
                    .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(AppColors.line, lineWidth: 1))

                    HStack {
                        Text("TRADER")
                        Spacer()
                        Text("SCORE")
                    }
                    .font(.system(size: 9, weight: .heavy))
                    .tracking(1)
                    .foregroundStyle(AppColors.muted)
                    .padding(.horizontal, 4)

                    if traders.isEmpty {
                        EmptyPicksCard(
                            title: store.snapshot == nil ? "Leaderboard is loading" : "No traders match",
                            detail: store.snapshot == nil ? "Load the daily feed to see scored wallets." : "Try another name or wallet address."
                        )
                    } else {
                        LazyVStack(spacing: 9) {
                            ForEach(traders) { trader in
                                NavigationLink {
                                    TraderDetailView(trader: trader)
                                } label: {
                                    TraderRow(trader: trader)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 28)
            }
            .background(AppColors.background.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

struct TraderRow: View {
    let trader: TraderSnapshot

    var body: some View {
        HStack(spacing: 12) {
            Text(String(format: "%03d", trader.rank))
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(AppColors.muted)
                .frame(width: 32, alignment: .leading)
            VStack(alignment: .leading, spacing: 5) {
                Text(trader.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Text("PnL \(DisplayFormat.money(trader.pnl))")
                    Text("Win \(DisplayFormat.percent(trader.winRate))")
                }
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(AppColors.muted)
                Text("Vol \(DisplayFormat.money(trader.volume))  ·  \(trader.activePositionCount) open sports")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(AppColors.muted.opacity(0.85))
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            ScoreBadge(score: trader.score, compact: true)
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(AppColors.muted.opacity(0.65))
        }
        .padding(12)
        .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppColors.line, lineWidth: 1))
    }
}

struct TraderDetailView: View {
    let trader: TraderSnapshot

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 19) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("SCORE RANK #\(trader.rank)  ·  PNL RANK #\(trader.pnlRank)")
                            .font(.system(size: 10, weight: .heavy))
                            .tracking(1)
                            .foregroundStyle(AppColors.lime)
                        Text(trader.name)
                            .font(.system(size: 27, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .textSelection(.enabled)
                        Text(trader.wallet)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(AppColors.muted)
                            .textSelection(.enabled)
                    }
                    Spacer()
                    ScoreBadge(score: trader.score)
                }
                .padding(.top, 14)

                HStack(spacing: 9) {
                    DetailStat(title: "ALL-TIME PNL", value: DisplayFormat.money(trader.pnl))
                    DetailStat(title: "SPORTS VOLUME", value: DisplayFormat.money(trader.volume))
                }
                HStack(spacing: 9) {
                    DetailStat(title: "SAMPLED WIN RATE", value: DisplayFormat.percent(trader.winRate))
                    DetailStat(title: "SETTLED SAMPLE", value: "\(trader.closedPositionsSampled)")
                }

                VStack(alignment: .leading, spacing: 11) {
                    SectionHeading(title: "Open sports positions", subtitle: "Largest tracked positions")
                    if trader.activePositions.isEmpty {
                        EmptyPicksCard(title: "No open sports positions found", detail: "This wallet may have closed its positions or the public API sample may be empty.")
                    } else {
                        ForEach(trader.activePositions) { position in
                            PositionRow(position: position)
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 11) {
                    SectionHeading(title: "Recent settled markets", subtitle: "Most recent sampled sports results")
                    if trader.recentResults.isEmpty {
                        EmptyPicksCard(title: "No settled sample yet", detail: "A win rate appears after the public API returns settled sports positions.")
                    } else {
                        ForEach(trader.recentResults) { result in
                            PastTradeRow(trade: result)
                        }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 28)
        }
        .background(AppColors.background.ignoresSafeArea())
        .navigationTitle("Trader")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }
}

struct DetailStat: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.system(size: 8, weight: .heavy))
                .tracking(0.8)
                .foregroundStyle(AppColors.muted)
            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(13)
        .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(AppColors.line, lineWidth: 1))
    }
}

struct SectionHeading: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 17, weight: .bold, design: .rounded)).foregroundStyle(.white)
            Text(subtitle).font(.system(size: 10, weight: .medium)).foregroundStyle(AppColors.muted)
        }
    }
}

struct PositionRow: View {
    let position: PositionSnapshot

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2).fill(AppColors.mint).frame(width: 3, height: 42)
            VStack(alignment: .leading, spacing: 5) {
                Text(position.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                Text("\(position.outcome)  ·  \(position.currentPrice.map { String(format: "%.0f¢", $0 * 100) } ?? "Price unavailable")")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(AppColors.muted)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 4) {
                Text(DisplayFormat.money(position.currentValue))
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text("open value")
                    .font(.system(size: 8, weight: .medium))
                    .foregroundStyle(AppColors.muted)
            }
        }
        .padding(12)
        .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 13))
    }
}

struct PastTradeRow: View {
    let trade: PastTradeSnapshot

    private var pnlColor: Color { trade.realizedPnl >= 0 ? AppColors.mint : AppColors.loss }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: trade.realizedPnl >= 0 ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(.system(size: 14))
                .foregroundStyle(pnlColor)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 4) {
                Text(trade.title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                Text("\(trade.outcome)  ·  \(DisplayFormat.relativeDate(trade.closedAt))")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(AppColors.muted)
            }
            Spacer(minLength: 5)
            Text(DisplayFormat.money(trade.realizedPnl))
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(pnlColor)
        }
        .padding(12)
        .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 13))
    }
}

struct MethodologyView: View {
    @Environment(AppStore.self) private var store
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 7) {
                        Text("How the signal works")
                            .font(.system(size: 29, weight: .bold, design: .rounded))
                            .tracking(-0.7)
                            .foregroundStyle(.white)
                        Text("A transparent read of public Polymarket sports data.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(AppColors.muted)
                    }
                    .padding(.top, 16)

                    VStack(spacing: 0) {
                        MethodRow(number: "01", title: "Find the universe", detail: "Read the all-time SPORTS leaderboard by PnL and page through its top 1,000 wallets.")
                        Divider().overlay(AppColors.line)
                        MethodRow(number: "02", title: "Measure trader history", detail: "Read up to 100 recent closed positions per wallet, retain sports results, and shrink small win-rate samples toward 50%.")
                        Divider().overlay(AppColors.line)
                        MethodRow(number: "03", title: "Score each wallet", detail: "Blend PnL rank (40%), win rate with a neutral four-result prior (30%), volume rank (15%), and open-position rank (15%).")
                        Divider().overlay(AppColors.line)
                        MethodRow(number: "04", title: "Rank today’s bets", detail: "Match wallet positions to active Polymarket sports markets scheduled later today, then require at least two wallets and 55% score-weighted support.")
                    }
                    .padding(.horizontal, 14)
                    .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(AppColors.line, lineWidth: 1))

                    if let method = store.snapshot?.methodology {
                        Text(method)
                            .font(.system(size: 10, weight: .medium))
                            .lineSpacing(3)
                            .foregroundStyle(AppColors.muted)
                            .padding(.horizontal, 2)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Label("Read before you act", systemImage: "exclamationmark.triangle.fill")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(AppColors.lime)
                        Text("This is an informational research tool. It does not place trades or predict results. Public data can be delayed, incomplete, or change after the daily snapshot. Prediction markets involve risk; only participate where legal and only with money you can afford to lose.")
                            .font(.system(size: 11, weight: .medium))
                            .lineSpacing(3)
                            .foregroundStyle(AppColors.muted)
                    }
                    .padding(14)
                    .background(AppColors.raised, in: RoundedRectangle(cornerRadius: 15))

                    Button {
                        showingSettings = true
                    } label: {
                        HStack {
                            Image(systemName: "slider.horizontal.3")
                                .foregroundStyle(AppColors.lime)
                            Text("Daily feed settings")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.white)
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(AppColors.muted)
                        }
                        .padding(14)
                        .background(AppColors.surface, in: RoundedRectangle(cornerRadius: 14))
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 28)
            }
            .background(AppColors.background.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .sheet(isPresented: $showingSettings) { FeedSettingsView() }
        }
    }
}

struct MethodRow: View {
    let number: String
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number)
                .font(.system(size: 10, weight: .heavy, design: .monospaced))
                .foregroundStyle(AppColors.lime)
                .frame(width: 22, alignment: .leading)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                Text(detail).font(.system(size: 10, weight: .medium)).lineSpacing(2).foregroundStyle(AppColors.muted)
            }
        }
        .padding(.vertical, 13)
    }
}

struct FeedSettingsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @AppStorage(AppConfiguration.feedPreferenceKey) private var customFeedURL = ""
    @State private var draftURL = ""
    @State private var didInitialize = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Daily feed") {
                    TextField("https://…/daily-picks.json", text: $draftURL, axis: .vertical)
                        .font(.system(size: 12, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .lineLimit(2...4)
                    Text("The GitHub Actions workflow publishes one JSON snapshot each day. The TestFlight build is configured to read your repository’s public raw feed URL.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button("Save and refresh") {
                        customFeedURL = draftURL.trimmingCharacters(in: .whitespacesAndNewlines)
                        Task {
                            await store.refresh()
                            dismiss()
                        }
                    }
                    .fontWeight(.semibold)
                    Button("Use the built-in feed", role: .destructive) {
                        customFeedURL = ""
                        draftURL = AppConfiguration.bundledFeedURL
                        Task { await store.refresh() }
                    }
                }

                Section("Refresh status") {
                    LabeledContent("Wallet universe", value: "\(store.snapshot?.universeSize ?? 0)")
                    LabeledContent("Open data loaded", value: "\(store.snapshot?.tradersWithOpenData ?? 0)")
                    LabeledContent("History loaded", value: "\(store.snapshot?.tradersWithHistoryData ?? 0)")
                    if let snapshot = store.snapshot {
                        LabeledContent("Snapshot date", value: snapshot.slateDate)
                        LabeledContent("Generated", value: DisplayFormat.date(snapshot.generatedAt, format: "MMM d, h:mm a 'ET'"))
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(AppColors.background)
            .navigationTitle("Feed settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                guard !didInitialize else { return }
                draftURL = customFeedURL.isEmpty ? AppConfiguration.bundledFeedURL : customFeedURL
                didInitialize = true
            }
        }
        .preferredColorScheme(.dark)
    }
}
