# Changelog

Semua perubahan penting pada proyek Meridian akan didokumentasikan di file ini.

## [1.6.2] - 2026-05-17

### Fixed
- `dry-run-simulator.js`: PnL simulasi tidak akurat karena dua bug:
  1. `estimated_fee_pct` dihitung dari `fee_tvl_ratio * hours * 0.5` — terlalu konservatif. Sekarang dikonversi dengan benar: `fee_tvl_ratio * 12 periods/hour * hours * 0.7` (12 = jumlah periode 5m per jam, 0.7 = LP capture rate)
  2. `_simulatePriceChange` menggunakan mean reversion ke 0 yang menyebabkan bias negatif. Sekarang menggunakan unbiased random walk dengan seed yang berubah per management cycle (12-menit bucket) sehingga hasil bervariasi
  3. PnL sekarang menggunakan harga real dari pool (`price_change_pct` atau `stats_1h.price_change`) jika tersedia, dengan simulasi sebagai fallback
  4. Model PnL diperbaiki: `fees - IL + upside_capture` alih-alih `price_change + fees`
- `user-config.json`: `minFeePerTvl24h` turun dari 8 ke 4 berdasarkan data virtual closes

---

## [1.6.1] - 2026-05-17

### Fixed
- `agent.js`: XML-style tool calls dari SwiftRouter/Claude yang bocor ke content pesan sekarang di-parse dan dieksekusi dengan benar. Sebelumnya tool call dalam format `<tool_call><function=deploy_position>...` diabaikan dan muncul sebagai teks mentah di notif Telegram, menyebabkan deploy tidak terjadi.

---

## [1.6.0] - 2026-05-17

### Added
- **causal-analysis.js**: Engine analisis kausal yang mengidentifikasi MENGAPA posisi profit atau loss
  - Menganalisis 9 faktor: smart wallet presence, narrative quality, token age, volatility, fee_tvl_ratio, range efficiency, close reason patterns, hold duration, organic score
  - Membandingkan win rate antar kelompok (dengan/tanpa smart wallet, berbagai range volatility, dll)
  - Menghasilkan lessons actionable dengan rekomendasi config spesifik (misal: "raise minOrganic to 75")
  - Deduplication otomatis — tidak menambah lesson yang sudah ada
  - Menyimpan riwayat run di `causal-analysis.json`
  - `getCausalAnalysisSummary()` — ringkasan untuk Telegram
- **Telegram command `/analysis`** — tampilkan hasil causal analysis terbaru

### Changed
- `lessons.js`: `runCausalAnalysis()` dipanggil otomatis setiap 5 closes, bersamaan dengan `evolveThresholds()` dan Darwin weight recalculation
- `index.js`: import dan expose `/analysis` command

### Technical
- Causal lessons diberi tag `["causal_analysis", type, confidence]` dan role-aware (SCREENER/MANAGER)
- Minimum 5 samples untuk analysis, minimum 2 per bucket untuk kesimpulan
- Effect threshold 0.25 (25% win rate difference) untuk dianggap signifikan

---

## [1.5.4] - 2026-05-17

### Fixed
- `tools/dlmm.js`: dry run `deploy_position` result sekarang include `success: true` dan `position` field sehingga LLM tidak mencoba deploy ulang karena mengira deploy gagal. Juga tambahkan instruksi eksplisit di `message` untuk tidak retry.

---

## [1.5.3] - 2026-05-17

### Fixed
- `state.js`: `syncOpenPositions()` crash dengan `TypeError: Cannot read properties of undefined (reading 'push')` karena virtual position tidak punya field `notes`. Fix: defensive `if (!Array.isArray(pos.notes)) pos.notes = []` sebelum push
- `state.js`: virtual positions sekarang di-skip oleh `syncOpenPositions()` — mereka tidak pernah ada on-chain jadi tidak boleh di-auto-close oleh sync
- `dry-run-simulator.js`: virtual position sekarang dibuat dengan `notes: []` untuk konsistensi dengan struktur position normal

---

## [1.5.2] - 2026-05-17

### Fixed
- `smart-wallets.js`: `saveWallets()` sekarang wrapped try-catch — EACCES permission error tidak lagi crash wallet evolution, hanya log warning
- `smart-wallets.js`: tambah `initSmartWalletsFile()` yang dipanggil saat startup untuk memastikan `smart-wallets.json` ada sebelum wallet evolution mencoba menulis
- `index.js`: panggil `initSmartWalletsFile()` di startup block sehingga file selalu ada di VPS meski tidak ada di git (karena di-gitignore)

---

## [1.5.1] - 2026-05-17

### Fixed
- `tools/token.js`: `global_fees_sol` selalu `null` saat official Jupiter API berhasil karena field ini tidak tersedia di official API. Sekarang di-enrich dari `datapi.jup.ag` secara paralel setelah official API call, sehingga `fees_sol` tidak lagi tampil sebagai `?` di screening report dan hard gate `fees_sol >= 35` bisa dievaluasi dengan benar.

---

## [1.5.0] - 2026-05-17

### Added
- **dry-run-simulator.js**: Mode demo account untuk dry run
  - `registerVirtualPosition()` — menyimpan posisi virtual ke `state.json` setelah dry-run deploy
  - `evaluateVirtualPositions()` — dijalankan setiap management cycle, fetch data pool real, simulasi PnL via seeded mean-reverting random walk berdasarkan volatilitas real
  - Menerapkan exit rules yang sama dengan live: stop loss, take profit, trailing TP, OOR, low yield
  - Saat virtual close: feed ke full learning pipeline (lessons, threshold evolution, pool memory, Darwin weights, decision log)
  - Auto-blacklist token + deployer saat fast stop loss (suspected rug)
  - Config optimizer: setiap 5 virtual closes, analisis performa dan tambahkan saran ke lessons dikalibrasi ke saldo wallet saat ini
  - `getVirtualSummary()` — win rate, avg PnL, ringkasan posisi open/closed
- **wallet-evolution.js**: Auto-discovery dan pruning smart wallet
  - Discover top LPer dari study data setiap screening cycle
  - Auto-add wallet dengan win rate ≥70%, minimal 2 posisi, avg PnL ≥20%
  - Update statistik wallet yang sudah di-track dengan rolling weighted average
  - Auto-remove wallet dengan win rate <40% setelah ≥5 posisi, atau tidak terlihat >30 hari
  - Wallet `source: "manual"` tidak pernah dihapus otomatis
  - Max 30 wallet untuk menjaga RPC check tetap cepat
- **Telegram command `/sim`** — tampilkan virtual trading summary (dry run stats)
- **Telegram command `/smart_wallets`** — daftar smart wallet yang di-track dengan stats
- **`.kiro/steering/changelog-rules.md`** — aturan update CHANGELOG dan README otomatis di-include setiap sesi

### Changed
- `smart-wallets.js`: `addSmartWallet()` sekarang menerima field `source` dan `stats` untuk membedakan wallet manual vs auto
- `index.js`: Integrasi dry-run simulator ke screening cycle (register virtual position) dan management cycle (evaluate virtual positions)
- `index.js`: Integrasi wallet evolution di akhir setiap screening cycle (background async)
- `agent.js`: SCREENER tidak lagi diblokir oleh `mustUseRealTool` — LLM bisa menjawab "no deploy" tanpa tool call
- `agent.js`: `tool_choice=required` dikecualikan untuk SCREENER di step 0
- `utils/datapi-limiter.js`: Ganti time-gate dengan promise queue agar parallel `Promise.allSettled` benar-benar serialized; tambah `x-api-key` header ke semua request `datapi.jup.ag`

### Fixed
- Screening cycle tidak lagi return error "I couldn't complete that reliably because no tool call was made" ketika LLM memutuskan tidak ada kandidat yang layak
- `datapi.jup.ag` 403 error pada `get_token_holders` dan `get_token_narrative` akibat concurrent requests yang burst rate limit

### Technical
- Virtual positions disimpan di `state.json` dengan flag `{ virtual: true }` — tidak terlihat oleh real position tracker
- Riwayat virtual closes diarsipkan di `virtual-positions.json`
- Promise queue di datapi-limiter memastikan max 1 request/1.1 detik secara global across semua callers
- `smart-wallets.json` dan `virtual-positions.json` sudah di-gitignore

---

## [1.4.0] - 2026-05-17

### Added
- **README.md**: Diperbarui lengkap dengan konten dari upstream — arsitektur, agent harness, decision log, Discord listener, HiveMind, config reference, PM2, disclaimer, smart wallet evolution, `/smart_wallets` command

---

## [1.3.0] - 2026-05-17

### Added
- **`.kiro/`**: Migrasi dari `.claude/` ke Kiro IDE
  - `steering/project.md` — konteks proyek selalu di-include (dari CLAUDE.md)
  - `steering/agent-manager.md` — panduan agent manager (manual inclusion)
  - `steering/agent-screener.md` — panduan agent screener (manual inclusion)
  - `steering/commands.md` — semua CLI quick commands (manual inclusion)
  - `hooks/no-background-exec.kiro.hook` — blokir background shell execution
  - `hooks/protect-env.kiro.hook` — blokir write ke file `.env`

---

## [1.2.0] - 2026-05-15

### Added
- **utils/lessonManager.js**: Sistem Lesson Scoring + Auto-Pruning untuk HiveMind
  - Scoring otomatis berdasarkan outcome performa selanjutnya
  - Auto-prune lesson dengan score rendah atau sudah terlalu lama
  - Feedback loop agar swarm learning semakin cerdas (Darwinian)
  - Fungsi `applyPerformanceFeedback`, `pruneLessons`, `runMaintenance`

### Changed
- `lessons.js`: Integrasi dasar dengan lessonManager (inisialisasi score + periodic prune + feedback)
- Version bump ke 1.2.0

### Technical
- Backward compatible: lesson lama otomatis mendapat score default
- Pruning aman: pinned + high-score + recent lessons dilindungi

Lihat `utils/lessonManager.js` untuk detail implementasi scoring & pruning.