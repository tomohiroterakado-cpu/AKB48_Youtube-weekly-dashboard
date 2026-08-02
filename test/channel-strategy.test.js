const test = require("node:test");
const assert = require("node:assert/strict");
const { buildStrategicWeeklyReport, topCategory } = require("../lib/channel-strategy");

function week(index, overrides = {}) {
  const start = `2026-0${4 + index}-04`;
  const end = `2026-0${4 + index}-10`;
  return {
    key: `${start}_${end}`,
    week: { start, end },
    kpis: [
      { label: "総視聴回数", value: 400000 + (index * 25000) },
      { label: "チャンネル登録者増加数", value: 600 + (index * 25) },
      { label: "新しい視聴者数", value: 20000 + (index * 1200) },
      { label: "リピーター", value: 70000 + (index * 2500) }
    ],
    topVideos: [{
      id: `video-${index}`,
      title: index % 2 ? "AKB48本気の対決企画" : "AKB48メンバーの舞台裏に密着",
      views: 50000 + (index * 3000),
      publishDate: start,
      durationSeconds: 900
    }],
    videoMetrics: [
      { id: `video-${index}-a`, title: "AKB48本気の対決企画", genre: "対決・勝負・イベント", members: ["メンバーA"], views: 50000 + (index * 3000), impressions: 500000, ctr: 7.2 },
      { id: `video-${index}-b`, title: "舞台裏に密着", genre: "密着・成長・舞台裏", members: ["メンバーB"], views: 38000 + (index * 1000), impressions: 400000, ctr: 6.1 },
      { id: `video-${index}-c`, title: "お知らせ", genre: "発表・告知", members: [], views: 18000, impressions: 250000, ctr: 4.2 }
    ],
    insights: [],
    actions: [],
    ideas: [],
    ...overrides
  };
}

function datedWeek(index, overrides = {}) {
  const startDate = new Date(Date.UTC(2025, 6, 5));
  startDate.setUTCDate(startDate.getUTCDate() + (index * 7));
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  const start = startDate.toISOString().slice(0, 10);
  const end = endDate.toISOString().slice(0, 10);
  const base = week(index % 5);
  return {
    ...base,
    key: `${start}_${end}`,
    week: { start, end },
    videoMetrics: (base.videoMetrics || []).map((video, videoIndex) => ({
      ...video,
      id: `${video.id}-${index}-${videoIndex}`,
      title: `${video.title} ${index}-${videoIndex}`
    })),
    ...overrides
  };
}

test("strategic weekly report connects three time horizons to nine grouped execution ideas", () => {
  const report = {
    weeks: [
      week(0),
      week(1),
      week(2),
      week(3),
      week(4, {
        marketReport: {
          data: {
            sections: [
              { key: "competitors", title: "競合・参考チャンネル", entries: [{ label: "参考チャンネル", text: "メンバー企画をシリーズ化している。" }] },
              { key: "youtube", title: "日本のYouTubeトレンド", entries: [{ label: "動画トレンド", text: "冒頭で結論を見せる構成が参考になる。" }] },
              { key: "social-search", title: "SNS / 検索トレンド", entries: [{ label: "検索動向", text: "季節イベントへの関心がある。" }] }
            ]
          }
        }
      })
    ]
  };

  const latest = buildStrategicWeeklyReport(report).weeks.at(-1);
  assert.equal(latest.channelTrends.horizons.length, 3);
  assert.deepEqual(latest.channelTrends.horizons.map((item) => item.label), ["短期", "中期", "長期"]);
  assert.equal(latest.actions.length, 3);
  assert.equal(latest.actions[0].horizon, "短期");
  assert.match(latest.actions[0].kpi, /対象週7日間/);
  assert.equal(latest.ideaGroups.length, 3);
  assert.deepEqual(latest.ideaGroups.map((group) => group.ideas.length), [3, 3, 3]);
  assert.equal(latest.ideas.length, 9);
  assert.deepEqual(latest.ideaGroups.map((group) => group.key), ["long-term", "recent-year", "market-trend"]);
  assert.match(latest.ideaGroups[2].ideas[0].aim, /参考チャンネル/);
  assert.match(latest.channelTrends.dimensions.find((item) => item.key === "members").text, /メンバーA/);
  assert.ok(latest.ideas.every((idea) => idea.evidencePeriod));
  assert.ok(latest.ideas.every((idea) => idea.proposalType));
  assert.equal(latest.ideaGroups[0].ideas[0].evidenceVideos[0].title, "AKB48本気の対決企画");
});

test("one week of data is explicitly marked as insufficient instead of inventing long-term trends", () => {
  const selected = buildStrategicWeeklyReport({ weeks: [week(0)] }).weeks[0];
  const medium = selected.channelTrends.horizons.find((item) => item.label === "中期");
  const long = selected.channelTrends.horizons.find((item) => item.label === "長期");
  assert.match(medium.status, /データ不足/);
  assert.match(long.status, /データ不足/);
  assert.match(selected.channelTrends.note, /現時点では統計的な信頼性が低い/);
  assert.equal(selected.ideas.length, 9);
  assert.ok(selected.ideas.every((idea) => idea.confidence === "低"));
  assert.ok(selected.ideas.every((idea) => idea.priority === "検証"));
  assert.match(selected.ideaGroups[1].title, /履歴を作る/);
  assert.match(selected.ideaGroups[2].title, /外部調査待ち/);
});

test("category tendency uses every CSV video instead of only the four featured videos", () => {
  const selectedWeek = week(0, {
    topVideos: [{ id: "featured", title: "発表動画", genre: "発表・告知", views: 999999 }],
    videoMetrics: [
      { id: "a", title: "対決1", genre: "対決・勝負・イベント", views: 60000, impressions: 100000, ctr: 8 },
      { id: "b", title: "対決2", genre: "対決・勝負・イベント", views: 55000, impressions: 100000, ctr: 7 },
      { id: "c", title: "密着", genre: "密着・成長・舞台裏", views: 20000, impressions: 100000, ctr: 4 }
    ]
  });
  const category = topCategory([selectedWeek]);
  assert.equal(category.name, "対決・勝負・イベント");
  assert.equal(category.videoCount, 2);
  assert.equal(category.medianViews, 57500);
  assert.deepEqual(category.examples.map((video) => video.title), ["対決1", "対決2"]);
});

test("missing audience metrics remain unavailable instead of becoming zero", () => {
  const weeks = [week(0), week(1), week(2), week(3)].map((item) => ({
    ...item,
    kpis: item.kpis.filter((kpi) => !/新しい視聴者|リピーター/.test(kpi.label))
  }));
  const selected = buildStrategicWeeklyReport({ weeks }).weeks.at(-1);
  const medium = selected.channelTrends.horizons.find((item) => item.label === "中期");
  assert.match(medium.findings.join(" "), /未取得/);
  assert.doesNotMatch(medium.findings.join(" "), /新しい視聴者は0人|リピーターは0人/);
});

test("missing video metrics stay unavailable instead of entering category medians as zero", () => {
  const category = topCategory([week(0, {
    videoMetrics: [
      { id: "missing", title: "未取得動画", genre: "対決・勝負・イベント", views: null },
      { id: "measured", title: "取得済み動画", genre: "対決・勝負・イベント", views: 2000 }
    ]
  })]);
  assert.equal(category.videoCount, 2);
  assert.equal(category.medianViews, 2000);
  assert.deepEqual(category.examples.map((video) => video.title), ["取得済み動画"]);
});

test("top-video-only legacy weeks are not mixed into all-video tendency analysis", () => {
  const category = topCategory([week(0, {
    videoMetrics: undefined,
    topVideos: [{ id: "featured", title: "限定された上位動画", genre: "発表・告知", views: 999999 }]
  })]);
  assert.equal(category.name, "判定不可");
  assert.equal(category.videoCount, 0);
});

test("sparse dates across a year are not treated as a complete recent-year history", () => {
  const sparse = [
    week(0, { week: { start: "2025-07-05", end: "2025-07-11" } }),
    week(1, { week: { start: "2026-06-20", end: "2026-06-26" } }),
    week(2, { week: { start: "2026-06-27", end: "2026-07-03" } }),
    week(3, { week: { start: "2026-07-04", end: "2026-07-10" } })
  ];
  const selected = buildStrategicWeeklyReport({ weeks: sparse }).weeks.at(-1);
  assert.match(selected.ideaGroups[1].title, /履歴を作る/);
  assert.match(selected.ideaGroups[1].basis, /4週分/);
});

test("partial external research is labelled as incomplete instead of three evidence-backed trends", () => {
  const selected = buildStrategicWeeklyReport({
    weeks: [week(0, {
      marketReport: { data: { sections: [
        { key: "competitors", title: "競合", entries: [{ label: "参考企画", text: "シリーズ企画が公開された。" }] }
      ] } }
    })]
  }).weeks[0];
  const group = selected.ideaGroups[2];
  assert.match(group.title, /不足/);
  assert.match(group.basis, /3領域中1領域/);
  assert.equal(group.ideas[0].evidenceType, "公開情報を使った参考提案");
  assert.equal(group.ideas[1].evidenceType, "AIによる企画案");
});

test("category medians give each video equal weight across repeated weekly observations", () => {
  const first = week(0, {
    videoMetrics: [{ id: "repeat", title: "対決の定番動画", genre: "対決・勝負・イベント", views: 1000 }]
  });
  const second = week(1, {
    videoMetrics: [
      { id: "repeat", title: "対決の定番動画", genre: "対決・勝負・イベント", views: 1000 },
      { id: "new", title: "対決の新作動画", genre: "対決・勝負・イベント", views: 9000 }
    ]
  });
  const category = topCategory([first, second]);
  assert.equal(category.videoCount, 2);
  assert.equal(category.medianViews, 5000);
});

test("unreviewed genre values are excluded from the confirmation coverage", () => {
  const selected = buildStrategicWeeklyReport({
    weeks: [week(0, {
      videoMetrics: [
        { id: "a", title: "動画A", genre: "未設定", views: 1000 },
        { id: "b", title: "動画B", genre: "未判定", views: 2000 },
        { id: "c", title: "動画C", genre: "その他", views: 3000 }
      ]
    })]
  }).weeks[0];
  assert.match(selected.channelTrends.note, /企画ジャンル確認率0%/);
});

test("one week stays low confidence even with many rows and complete market research", () => {
  const videoMetrics = Array.from({ length: 60 }, (_, index) => ({
    id: `many-${index}`,
    title: `対決企画${index}`,
    genre: "対決・勝負・イベント",
    views: 10000 + index,
    impressions: 100000,
    ctr: 6
  }));
  const marketReport = { data: { sections: [
    { key: "competitors", entries: [{ label: "競合", text: "シリーズ企画" }] },
    { key: "youtube", entries: [{ label: "YouTube", text: "冒頭訴求" }] },
    { key: "social-search", entries: [{ label: "SNS", text: "季節検索" }] }
  ] } };
  const selected = buildStrategicWeeklyReport({ weeks: [week(0, { videoMetrics, marketReport })] }).weeks[0];
  assert.ok(selected.actions.every((item) => item.confidence === "低"));
  assert.ok(selected.ideaGroups[0].ideas.every((item) => item.confidence === "低"));
});

test("repeated observations of the same videos do not inflate confidence to high", () => {
  const repeatedWeeks = Array.from({ length: 13 }, (_, index) => datedWeek(index, {
    videoMetrics: [
      { id: "repeat-a", title: "定番対決", genre: "対決・勝負・イベント", views: 50000, impressions: 500000, ctr: 7 },
      { id: "repeat-b", title: "定番密着", genre: "密着・成長・舞台裏", views: 40000, impressions: 400000, ctr: 6 },
      { id: "repeat-c", title: "定番トーク", genre: "関係性・トーク", views: 30000, impressions: 300000, ctr: 5 }
    ]
  }));
  repeatedWeeks.at(-1).marketReport = { data: { sections: [
    { key: "competitors", entries: [{ label: "競合", text: "シリーズ企画" }] },
    { key: "youtube", entries: [{ label: "YouTube", text: "冒頭訴求" }] },
    { key: "social-search", entries: [{ label: "SNS", text: "季節検索" }] }
  ] } };

  const selected = buildStrategicWeeklyReport({ weeks: repeatedWeeks }).weeks.at(-1);
  assert.notEqual(selected.channelTrends.confidence.label, "高");
  assert.equal(selected.channelTrends.confidence.videoCount, 3);
  assert.equal(selected.channelTrends.confidence.observations, 39);
});

test("next actions state the channel dimensions used for each decision", () => {
  const selected = buildStrategicWeeklyReport({ weeks: [week(0), week(1), week(2), week(3)] }).weeks.at(-1);
  assert.deepEqual(selected.actions.map((item) => item.evidenceDimensions), [
    ["企画内容", "出演メンバー"],
    ["時期・月別差", "企画内容"],
    ["企画内容", "外部環境", "時期・月別差"]
  ]);
});

test("complete recent-year history produces distinct long-term and recent-year idea roles", () => {
  const weeks = Array.from({ length: 53 }, (_, index) => datedWeek(index));
  const selected = buildStrategicWeeklyReport({ weeks }).weeks.at(-1);
  assert.match(selected.ideaGroups[1].title, /直近1年の変化/);
  assert.deepEqual(selected.ideaGroups[0].ideas.map((item) => item.proposalType), ["番組資産", "関係性検証", "月別定点"]);
  assert.deepEqual(selected.ideaGroups[1].ideas.map((item) => item.proposalType), ["直近再検証", "新規入口", "連動展開"]);
});

test("member tendency requires at least two videos for the same member", () => {
  const selected = buildStrategicWeeklyReport({ weeks: [week(0, {
    videoMetrics: [{ id: "solo", title: "単発出演", genre: "関係性・トーク", members: ["メンバーC"], views: 10000 }]
  })] }).weeks[0];
  const member = selected.channelTrends.dimensions.find((item) => item.key === "members");
  assert.equal(member.status, "判定不可");
  assert.match(member.text, /2本以上/);
});

test("season tendency requires three months with at least three observed weeks each", () => {
  const insufficient = Array.from({ length: 8 }, (_, index) => datedWeek(index));
  const insufficientSeason = buildStrategicWeeklyReport({ weeks: insufficient }).weeks.at(-1)
    .channelTrends.dimensions.find((item) => item.key === "season");
  assert.equal(insufficientSeason.status, "判定不可");

  const sufficient = Array.from({ length: 14 }, (_, index) => datedWeek(index));
  const sufficientSeason = buildStrategicWeeklyReport({ weeks: sufficient }).weeks.at(-1)
    .channelTrends.dimensions.find((item) => item.key === "season");
  assert.equal(sufficientSeason.status, "月別差の参考");
  assert.match(sufficientSeason.text, /季節性とは判定しません/);
});

test("external references retain URLs for direct source inspection", () => {
  const selected = buildStrategicWeeklyReport({ weeks: [week(0, {
    marketReport: { data: { sections: [{
      key: "competitors",
      title: "競合",
      entries: [{ label: "参考企画", text: "シリーズ企画", url: "https://example.com/source" }]
    }] } }
  })] }).weeks[0];
  assert.equal(selected.ideaGroups[2].ideas[0].externalReferences[0].url, "https://example.com/source");
});

test("strategy wording does not claim publication-age-normalized metrics", () => {
  const selected = buildStrategicWeeklyReport({ weeks: [week(0), week(1), week(2), week(3)] }).weeks.at(-1);
  const serialized = JSON.stringify({ trends: selected.channelTrends, actions: selected.actions, groups: selected.ideaGroups });
  assert.doesNotMatch(serialized, /公開後7日/);
  assert.match(serialized, /対象週7日間/);
});

test("empty all-video data creates history-building ideas without using 判定不可 as a genre", () => {
  const selected = buildStrategicWeeklyReport({ weeks: [week(0, { videoMetrics: [] })] }).weeks[0];
  assert.equal(selected.ideas.length, 9);
  assert.ok(selected.ideaGroups[0].ideas.every((item) => item.priority === "検証"));
  assert.ok(selected.ideaGroups[0].ideas.every((item) => !item.name.includes("判定不可")));
  assert.match(selected.ideaGroups[0].basis, /履歴形成案/);
  assert.doesNotMatch(selected.actions.map((item) => item.title).join(" "), /判定不可/);
});

test("short and medium windows are labelled as report runs instead of continuous calendar weeks", () => {
  const sparse = [
    week(0, { week: { start: "2026-01-03", end: "2026-01-09" } }),
    week(1, { week: { start: "2026-03-07", end: "2026-03-13" } }),
    week(2, { week: { start: "2026-06-06", end: "2026-06-12" } }),
    week(3, { week: { start: "2026-07-04", end: "2026-07-10" } })
  ];
  const selected = buildStrategicWeeklyReport({ weeks: sparse }).weeks.at(-1);
  assert.match(selected.channelTrends.horizons[0].period, /直近4回分/);
  assert.match(selected.channelTrends.horizons[1].period, /直近13回分/);
  assert.doesNotMatch(JSON.stringify(selected.channelTrends.horizons), /直近4週|直近13週/);
});

test("each next action rationale states evidence for every declared decision axis", () => {
  const selected = buildStrategicWeeklyReport({ weeks: [week(0), week(1), week(2), week(3)] }).weeks.at(-1);
  assert.match(selected.actions[0].rationale, /仮集計|直近全動画/);
  assert.match(selected.actions[0].rationale, /出演/);
  assert.match(selected.actions[1].rationale, /企画分類/);
  assert.match(selected.actions[1].rationale, /月別差|比較できる月/);
  assert.match(selected.actions[2].rationale, /外部/);
  assert.match(selected.actions[2].rationale, /月別差|比較できる月/);
});

test("member tendency uses the median of each video's weekly observations", () => {
  const first = week(0, { videoMetrics: [
    { id: "repeat-a", title: "出演A", genre: "関係性・トーク", members: ["メンバーA"], views: 1000 },
    { id: "repeat-b", title: "出演B", genre: "関係性・トーク", members: ["メンバーA"], views: 4000 }
  ] });
  const second = week(1, { videoMetrics: [
    { id: "repeat-a", title: "出演A", genre: "関係性・トーク", members: ["メンバーA"], views: 9000 },
    { id: "repeat-b", title: "出演B", genre: "関係性・トーク", members: ["メンバーA"], views: 4000 }
  ] });
  const member = buildStrategicWeeklyReport({ weeks: [first, second] }).weeks.at(-1)
    .channelTrends.dimensions.find((item) => item.key === "members");
  assert.match(member.text, /4,500回/);
});

test("unsafe external reference URLs are removed before reaching the report", () => {
  const selected = buildStrategicWeeklyReport({ weeks: [week(0, {
    marketReport: { data: { sections: [{
      key: "competitors",
      title: "競合",
      entries: [{ label: "危険なリンク", text: "参考情報", url: "javascript:alert(1)" }]
    }] } }
  })] }).weeks[0];
  assert.equal(selected.ideaGroups[2].ideas[0].externalReferences[0].url, "");
});

test("long-term ideas use independent category, member, and month evidence", () => {
  const selected = buildStrategicWeeklyReport({ weeks: Array.from({ length: 14 }, (_, index) => datedWeek(index)) }).weeks.at(-1);
  const ideas = selected.ideaGroups[0].ideas;
  assert.match(ideas[0].evidenceMetrics.join(" "), /対決・勝負・イベント/);
  assert.match(ideas[1].evidenceMetrics.join(" "), /メンバーA/);
  assert.match(ideas[2].evidenceMetrics.join(" "), /月別|季節性/);
});
