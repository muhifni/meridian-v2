# Meridian

**Meridian** adalah agent otonom berbasis AI yang dirancang untuk mengelola likuiditas secara otomatis di **Meteora DLMM** (Dynamic Liquidity Market Maker) di blockchain Solana.

**Links:** [Website](https://agentmeridian.xyz) | [Telegram](https://t.me/agentmeridian) | [X](https://x.com/meridian_agent)

Meridian menjalankan siklus screening dan management secara terus-menerus — men-deploy modal ke pool Meteora DLMM berkualitas tinggi dan menutup posisi berdasarkan data PnL, yield, dan range secara live. Ia belajar dari setiap posisi yang ditutup.

---

## Apa yang Dilakukan Meridian

- **Screening pool** — memindai pool Meteora DLMM berdasarkan threshold yang bisa dikonfigurasi (fee/TVL ratio, organic score, jumlah holder, mcap, bin step) dan menemukan peluang terbaik
- **Manajemen posisi** — memantau, mengklaim fee, dan menutup posisi LP secara otonom; memutuskan STAY, CLOSE, atau REDEPLOY berdasarkan data live
- **Belajar dari performa** — mempelajari top LPer di pool target, menyimpan pelajaran terstruktur, dan mengembangkan threshold screening berdasarkan riwayat posisi yang ditutup
- **Smart wallet evolution** — secara otomatis menemukan wallet LP berkualitas dari data study, menambahkan yang bagus, dan membuang yang performanya menurun
- **Dry run simulator** — mode demo account: saat `DRY_RUN=true`, agent melacak posisi virtual menggunakan data pasar real, mensimulasikan PnL, dan belajar dari setiap virtual close persis seperti posisi live
- **Discord signals** — listener Discord opsional yang memantau channel LP Army untuk sinyal token Solana dan mengantrekannya untuk screening
- **Telegram chat** — chat agent lengkap via Telegram, plus laporan siklus dan alert OOR
- **Kiro integration** — jalankan screening dan management bertenaga AI langsung dari editor menggunakan steering files dan hooks

---

## Cara Kerjanya

Meridian menjalankan **ReAct agent loop** — setiap siklus LLM berpikir atas data live, memanggil tools, dan bertindak. Dua agent khusus berjalan pada jadwal cron independen:

| Agent | Interval default | Peran |
|---|---|---|
| **Screening Agent** | Setiap 30 menit | Screening pool — menemukan dan men-deploy ke kandidat terbaik |
| **Management Agent** | Setiap 10 menit | Manajemen posisi — mengevaluasi setiap posisi terbuka dan bertindak |

### Agent harness

Agent harness Meridian adalah wrapper runtime di setiap siklus otonom. Ia memberi kedua agent loop kontrol yang sama: memuat state live, menyuntikkan memori relevan, mengekspos hanya tools yang sesuai peran, mengeksekusi tool calls, dan mengembalikan laporan siklus yang mudah dibaca.

Harness juga menyimpan decision log terstruktur di `decision-log.json` untuk deploy, close, skip, dan no-deploy. Setiap entri mencatat aktor, pool atau posisi, ringkasan, alasan, risiko utama, metrik, dan alternatif yang ditolak. Keputusan terbaru disuntikkan kembali ke system prompt sehingga agent bisa menjawab "kenapa kamu deploy?", "kenapa kamu close?", atau "kenapa kamu skip?" tanpa menebak-nebak.

**Sumber data:**
- `@meteora-ag/dlmm` SDK — data posisi on-chain, active bin, transaksi deploy/close
- Meteora DLMM PnL API — yield posisi, akumulasi fee, PnL
- OKX OnchainOS — sinyal smart money, scoring risiko token
- Pool screening API — fee/TVL ratio, volume, organic score, jumlah holder
- Jupiter API — audit token, mcap, launchpad, statistik harga

Agent ditenagai via **OpenRouter** atau provider kompatibel lainnya dan bisa diganti model kapan saja.

---

## Kebutuhan

- Node.js 18+
- [OpenRouter](https://openrouter.ai) API key (atau SwiftRouter / provider lain yang kompatibel)
- Solana wallet (private key base58)
- Solana RPC endpoint ([Helius](https://helius.xyz) direkomendasikan)
- Telegram bot token (opsional)

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/muhifni/meridian.git
cd meridian
npm install
```

### 2. Jalankan setup wizard

```bash
npm run setup
```

Wizard akan memandu kamu membuat `.env` (API keys, wallet, RPC, Telegram) dan `user-config.json` (preset risiko, ukuran deploy, threshold, model). Butuh sekitar 2 menit.

**Atau setup manual:**

Buat `.env`:

```env
WALLET_PRIVATE_KEY=your_base58_private_key
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
OPENROUTER_API_KEY=sk-or-...
HELIUS_API_KEY=your_helius_key          # untuk wallet balance lookup
TELEGRAM_BOT_TOKEN=123456:ABC...        # opsional — untuk notifikasi + chat
TELEGRAM_CHAT_ID=                       # auto-diisi saat pesan pertama
DRY_RUN=true                            # set false untuk live trading
```

> Jangan pernah taruh private key atau API key di `user-config.json` — gunakan `.env` saja. Kedua file sudah di-gitignore.

Salin config dan edit sesuai kebutuhan:

```bash
cp user-config.example.json user-config.json
```

### 3. Jalankan

```bash
npm run dev    # dry run — tidak ada transaksi on-chain
npm start      # live mode
```

Saat startup Meridian mengambil saldo wallet, posisi terbuka, dan kandidat pool teratas, lalu langsung memulai siklus otonom.

### Jalankan dengan PM2

PM2 didukung dan merupakan cara yang direkomendasikan untuk menjaga Telegram control tetap online di VPS:

```bash
npm install
npm run pm2:start
pm2 save
```

Untuk update instalasi PM2 yang sudah ada:

```bash
git pull
npm install
npm run pm2:restart
```

Jika proses terus restart setelah update, periksa error app terlebih dahulu:

```bash
npm run pm2:logs
```

Sebagian besar crash PM2 setelah update adalah error startup — biasanya karena lupa `npm install` setelah `package-lock.json` berubah, menjalankan PM2 dari direktori yang salah, atau nilai `.env` / `user-config.json` yang hilang. Hindari `nohup`; ia berjalan di luar PM2 dan bisa meninggalkan Telegram polling sebagai proses duplikat yang tidak terkelola.

---

## Menggunakan LLM Provider Lain (SwiftRouter, OpenAI, Local, dll)

Meridian tidak terbatas hanya bisa pakai OpenRouter. Kamu bisa menggunakan **SwiftRouter**, OpenAI, Groq, Together AI, atau bahkan model lokal (LM Studio / Ollama).

### Cara Paling Mudah: Setup Wizard

```bash
npm run setup
```

Wizard akan bertanya LLM Provider mana yang ingin kamu pakai.

### Cara Manual

Tambahkan baris berikut di `.env`:

```env
LLM_BASE_URL=https://api.swiftrouter.com/v1
LLM_API_KEY=sk-isi-dengan-api-key-mu
LLM_MODEL=claude-sonnet-4-6
```

### Model lokal (LM Studio)

```env
LLM_BASE_URL=http://localhost:1234/v1
LLM_API_KEY=lm-studio
LLM_MODEL=your-local-model-name
```

Semua endpoint kompatibel OpenAI bisa digunakan.

### Rekomendasi Model

| Model | Kualitas | Catatan | Rekomendasi |
|---|---|---|---|
| `claude-sonnet-4-6` | Sangat Baik | Paling stabil, tool calling terbaik | **Sangat Direkomendasikan** |
| `gemini-2.5-pro` | Baik | Cepat dan cukup murah | Bagus |
| `deepseek-r1-0528` | Baik | Reasoning sangat kuat | Bisa dicoba |

---

## Mode Operasi

### Autonomous agent

```bash
npm start
```

Memulai agent otonom penuh dengan siklus screening + management berbasis cron dan REPL interaktif. Prompt menampilkan countdown ke siklus berikutnya:

```
[manage: 8m 12s | screen: 24m 3s]
>
```

Perintah REPL:

| Perintah | Deskripsi |
|---|---|
| `/status` | Saldo wallet dan posisi terbuka |
| `/candidates` | Re-screen dan tampilkan kandidat pool teratas |
| `/learn` | Pelajari top LPer di semua pool kandidat saat ini |
| `/learn <pool_address>` | Pelajari top LPer untuk pool tertentu |
| `/thresholds` | Threshold screening saat ini dan statistik performa |
| `/evolve` | Trigger evolusi threshold dari data performa (butuh 5+ posisi tertutup) |
| `/stop` | Shutdown graceful |
| `<apapun>` | Chat bebas — tanya agent apapun, minta tindakan, analisis pool |

### CLI (invokasi tool langsung)

CLI `meridian` memberi akses langsung ke setiap tool dengan output JSON — berguna untuk scripting, debugging, atau piping ke tool lain.

```bash
npm install -g .   # install global (sekali)
meridian <command> [flags]
```

Atau tanpa install:

```bash
node cli.js <command> [flags]
```

**Posisi & PnL**
```bash
meridian positions
meridian pnl <position_address>
meridian wallet-positions --wallet <addr>
```

**Screening**
```bash
meridian candidates --limit 5
meridian pool-detail --pool <addr> [--timeframe 5m]
meridian active-bin --pool <addr>
meridian search-pools --query <name_or_symbol>
meridian study --pool <addr> [--limit 4]
```

**Riset token**
```bash
meridian token-info --query <mint_or_symbol>
meridian token-holders --mint <addr> [--limit 20]
meridian token-narrative --mint <addr>
```

**Deploy & manage**
```bash
meridian deploy --pool <addr> --amount <sol> [--bins-below 69] [--strategy bid_ask|spot|curve]
meridian claim --position <addr>
meridian close --position <addr>
meridian swap --from <mint> --to <mint> --amount <n>
meridian add-liquidity --position <addr> --pool <addr> [--amount-x <n>] [--amount-y <n>]
meridian withdraw-liquidity --position <addr> --pool <addr> [--bps 10000]
```

**Siklus agent**
```bash
meridian screen    # satu siklus screening AI
meridian manage    # satu siklus management AI
meridian start     # mulai agent otonom dengan cron jobs
```

**Config**
```bash
meridian config get
meridian config set <key> <value>
```

**Learning & memory**
```bash
meridian lessons
meridian lessons add "teks pelajaran kamu"
meridian performance [--limit 200]
meridian evolve
meridian pool-memory --pool <addr>
```

**Blacklist**
```bash
meridian blacklist list
meridian blacklist add --mint <addr> --reason "alasan"
```

**Discord signals**
```bash
meridian discord-signals
meridian discord-signals clear
```

**Balance**
```bash
meridian balance
```

**Flags**

| Flag | Efek |
|---|---|
| `--dry-run` | Skip semua transaksi on-chain |
| `--silent` | Suppress notifikasi Telegram untuk run ini |

---

## Discord Listener

Discord listener memantau channel yang dikonfigurasi (misalnya LP Army) untuk sinyal token Solana dan mengantrekannya sebagai sinyal untuk screener agent.

### Setup

```bash
cd discord-listener
npm install
```

Tambahkan ke `.env` root:

```env
DISCORD_USER_TOKEN=your_discord_account_token
DISCORD_GUILD_ID=the_server_id
DISCORD_CHANNEL_IDS=channel1,channel2
DISCORD_MIN_FEES_SOL=5
```

> Ini menggunakan selfbot (otomasi akun personal, bukan bot token). Gunakan dengan bijak.

### Jalankan

```bash
cd discord-listener
npm start
```

Sinyal ditulis ke `discord-signals.json` dan otomatis dipickup oleh siklus screening.

### Pipeline sinyal

Setiap alamat token yang masuk melewati pipeline pre-check sebelum diantrekan:

1. **Dedup** — mengabaikan alamat yang terlihat dalam 10 menit terakhir
2. **Blacklist** — menolak mint token yang di-blacklist
3. **Pool resolution** — resolve alamat ke pool Meteora DLMM
4. **Rug check** — cek deployer terhadap `deployer-blacklist.json`
5. **Fees check** — menolak pool di bawah `DISCORD_MIN_FEES_SOL`

Sinyal yang lolos semua pengecekan diantrekan dengan status `pending`. Screener mengambil sinyal pending dan memprosesnya sebagai kandidat prioritas sebelum menjalankan siklus screening normal.

---

## Telegram

### Setup

1. Buat bot via [@BotFather](https://t.me/BotFather) dan salin token-nya
2. Tambahkan `TELEGRAM_BOT_TOKEN=<token>` ke `.env`
3. Set chat ID dan user ID yang diizinkan di `.env`:

```env
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<target chat id>
TELEGRAM_ALLOWED_USER_IDS=<comma-separated Telegram user ids>
```

Catatan keamanan:
- Jika `TELEGRAM_CHAT_ID` tidak di-set, kontrol inbound Telegram diabaikan
- Notifikasi tetap dikirim ke chat yang dikonfigurasi, tapi kontrol dibatasi ke user ID yang diizinkan

### Notifikasi yang dikirim

- Setelah setiap siklus management: laporan agent lengkap (reasoning + keputusan)
- Setelah setiap siklus screening: laporan agent lengkap (apa yang ditemukan, apakah deploy)
- Saat posisi keluar range melewati `outOfRangeWaitMinutes`
- Saat deploy: pair, jumlah, alamat posisi, tx hash
- Saat close: pair dan PnL

### Telegram commands

| Command | Aksi |
|---|---|
| `/help` | Tampilkan semua commands |
| `/status` | Snapshot wallet + posisi |
| `/wallet` | Wallet, deploy amount, status HiveMind |
| `/positions` | Daftar posisi terbuka |
| `/pool <n>` | Info detail satu posisi terbuka |
| `/close <n>` | Tutup posisi berdasarkan index |
| `/closeall` | Tutup semua posisi terbuka |
| `/set <n> <note>` | Set catatan/instruksi pada posisi |
| `/config` | Tampilkan config runtime penting |
| `/settings` | Menu tombol untuk config umum |
| `/setcfg <key> <value>` | Update config yang tersimpan |
| `/screen` | Refresh daftar kandidat deterministik |
| `/candidates` | Tampilkan kandidat terbaru yang di-cache |
| `/deploy <n>` | Deploy kandidat berdasarkan index cache |
| `/smart_wallets` | Daftar smart wallet yang di-track |
| `/sim` | Virtual trading summary (dry run stats) |
| `/briefing` | Morning briefing |
| `/hive` | Status sinkronisasi HiveMind |
| `/hive pull` | Manual HiveMind pull sekarang |
| `/pause` | Hentikan siklus cron |
| `/resume` | Mulai kembali siklus cron |
| `/stop` | Matikan agent |

Kamu juga bisa chat bebas via Telegram menggunakan interface yang sama seperti REPL.

---

## Config Reference

Semua field opsional — default ditampilkan. Edit `user-config.json`.

### Screening

| Field | Default | Deskripsi |
|---|---|---|
| `minFeeActiveTvlRatio` | `0.05` | Minimum fee/active-TVL ratio |
| `minTvl` | `10000` | Minimum TVL pool (USD) |
| `maxTvl` | `150000` | Maximum TVL pool (USD) |
| `minVolume` | `500` | Minimum volume pool |
| `minOrganic` | `60` | Minimum organic score (0–100) |
| `minHolders` | `500` | Minimum jumlah holder token |
| `minMcap` | `150000` | Minimum market cap (USD) |
| `maxMcap` | `10000000` | Maximum market cap (USD) |
| `minBinStep` | `80` | Minimum bin step |
| `maxBinStep` | `125` | Maximum bin step |
| `timeframe` | `5m` | Timeframe candle untuk screening |
| `category` | `trending` | Filter kategori pool |
| `minTokenFeesSol` | `30` | Minimum all-time fees dalam SOL |
| `maxBundlersPct` | `30` | Maximum % bundler di top 100 holder |
| `maxTop10Pct` | `60` | Maximum konsentrasi top-10 holder |
| `blockedLaunchpads` | `[]` | Nama launchpad yang tidak pernah di-deploy |

### Management

| Field | Default | Deskripsi |
|---|---|---|
| `deployAmountSol` | `0.5` | Base SOL per posisi baru |
| `positionSizePct` | `0.35` | Fraksi saldo yang bisa di-deploy |
| `maxDeployAmount` | `50` | Cap maksimum SOL per posisi |
| `gasReserve` | `0.2` | Minimum SOL yang disimpan untuk gas |
| `minSolToOpen` | `0.55` | Minimum wallet SOL sebelum membuka posisi |
| `outOfRangeWaitMinutes` | `30` | Menit OOR sebelum bertindak |
| `stopLossPct` | `-15` | Tutup posisi jika harga turun sebesar ini |
| `takeProfitPct` | `12` | Tutup posisi jika total return mencapai ini |
| `trailingTakeProfit` | `true` | Aktifkan trailing take profit |
| `trailingTriggerPct` | `4` | Aktifkan trailing saat PnL mencapai % ini |
| `trailingDropPct` | `1.5` | Tutup saat turun % ini dari peak |

### Schedule

| Field | Default | Deskripsi |
|---|---|---|
| `managementIntervalMin` | `10` | Frekuensi siklus management (menit) |
| `screeningIntervalMin` | `30` | Frekuensi siklus screening (menit) |

### Model

| Field | Default | Deskripsi |
|---|---|---|
| `managementModel` | `openrouter/healer-alpha` | LLM untuk siklus management |
| `screeningModel` | `openrouter/hunter-alpha` | LLM untuk siklus screening |
| `generalModel` | `openrouter/healer-alpha` | LLM untuk REPL / chat |

> Override model saat runtime: `node cli.js config set screeningModel anthropic/claude-opus-4-5`

---

## Cara Meridian Belajar

### Lessons

Setelah setiap posisi ditutup, agent menjalankan `studyTopLPers` di pool kandidat, menganalisis perilaku on-chain top performer (durasi hold, timing entry/exit, win rate), dan menyimpan pelajaran konkret. Pelajaran disuntikkan ke siklus agent berikutnya sebagai bagian dari konteks sistem.

Tambah pelajaran secara manual:

```bash
node cli.js lessons add "Jangan pernah deploy ke token pump.fun di bawah 2 jam"
```

### Evolusi threshold

Setelah 5+ posisi ditutup, jalankan:

```bash
node cli.js evolve
```

Ini menganalisis performa posisi yang ditutup (win rate, avg PnL, fee yield) dan secara otomatis menyesuaikan threshold screening di `user-config.json`. Perubahan langsung berlaku.

### Smart wallet evolution

Setiap siklus screening, Meridian secara otomatis:
- Mempelajari top LPer dari pool kandidat teratas
- Menambahkan wallet dengan win rate ≥70%, minimal 2 posisi, dan avg PnL ≥20%
- Memperbarui statistik wallet yang sudah di-track dengan rolling average
- Membuang wallet dengan win rate <40% setelah 5+ posisi, atau yang tidak terlihat >30 hari

Wallet yang ditambahkan secara manual tidak pernah dihapus otomatis.

### Dry run simulator

Saat `DRY_RUN=true`, Meridian berjalan sebagai **demo account** — semua screening dan decision-making berjalan normal, tapi tidak ada transaksi on-chain. Setiap kali agent memutuskan deploy, posisi virtual dibuat dan dilacak menggunakan data pasar real.

Setiap management cycle, simulator:
- Fetch data pool real untuk menghitung PnL simulasi
- Terapkan exit rules yang sama (stop loss, trailing TP, OOR, low yield)
- Saat virtual close: feed ke learning pipeline yang sama dengan posisi live

Setelah 5 virtual closes, **config optimizer** menganalisis performa dan menambahkan saran penyesuaian config ke lessons — dikalibrasi ke saldo wallet saat ini.

Semua data yang terkumpul selama dry run (lessons, pool memory, blacklist, signal weights) langsung dipakai saat kamu switch ke live.

```bash
/sim    # lihat virtual trading summary di Telegram
```

---

## HiveMind

HiveMind sync menggunakan Agent Meridian di `https://api.agentmeridian.xyz` secara default. Agent bisa mendaftar, menarik pelajaran/preset bersama, dan mendorong event pembelajaran tanpa alur registrasi terpisah.

**Yang kamu dapatkan:**
- Pelajaran bersama dari agent Meridian lain
- Preset strategi dan konteks performa kolektif
- Pelajaran yang sadar peran disuntikkan ke prompt screener/manager saat `hiveMindPullMode` adalah `auto`

**Yang kamu bagikan:**
- Pelajaran dari `lessons.json`
- Event performa posisi tertutup: pool, nama pool, base mint, strategi, alasan close, PnL, fee, dan hold time
- Metadata heartbeat agent: agent ID, versi, timestamp, dan flag kapabilitas dasar
- **Private key dan saldo wallet tidak pernah dikirim**

Kegagalan HiveMind tidak memblokir agent. Jika Agent Meridian tidak tersedia, agent mencatat peringatan dan terus berjalan.

Config yang relevan:

```json
{
  "agentId": "",
  "hiveMindUrl": "",
  "hiveMindApiKey": "",
  "hiveMindPullMode": "auto"
}
```

Set `hiveMindPullMode` ke `manual` jika kamu tidak ingin pelajaran dan preset bersama ditarik secara otomatis.

---

## Arsitektur

```
index.js              Main entry: REPL + cron orchestration + Telegram bot polling
agent.js              ReAct loop: LLM → tool call → repeat
config.js             Runtime config dari user-config.json + .env
prompt.js             System prompt builder (peran SCREENER / MANAGER / GENERAL)
state.js              Position registry (state.json)
decision-log.js       Decision log terstruktur untuk deploy, close, skip, no-deploy
lessons.js            Learning engine: catat performa, turunkan pelajaran, evolusi threshold
pool-memory.js        Riwayat deploy per pool + snapshot
strategy-library.js   Strategi LP tersimpan
wallet-evolution.js   Auto-discovery dan pruning smart wallet
dry-run-simulator.js  Demo account mode — virtual positions + learning pipeline saat dry run
telegram.js           Telegram bot: polling + notifikasi
hivemind.js           Agent Meridian HiveMind sync
smart-wallets.js      Tracker wallet KOL/alpha
token-blacklist.js    Blacklist token permanen
cli.js                CLI langsung — setiap tool sebagai subcommand dengan output JSON

tools/
  definitions.js      Skema tool (format OpenAI)
  executor.js         Dispatch tool + safety checks
  dlmm.js             Wrapper Meteora DLMM SDK
  screening.js        Penemuan pool
  wallet.js           Saldo SOL/token + Jupiter swap
  token.js            Info token, holder, narasi
  study.js            Studi top LPer via LPAgent API

discord-listener/
  index.js            Selfbot Discord listener
  pre-checks.js       Pipeline pre-check sinyal

.kiro/
  steering/           Steering files untuk Kiro IDE
  hooks/              Hooks otomasi untuk Kiro IDE
```

---

## Versioning & Changelog

Mulai dari versi **1.1.0**, proyek ini menggunakan **Semantic Versioning**.

Semua perubahan penting dicatat di [CHANGELOG.md](./CHANGELOG.md).

---

## Disclaimer

Software ini disediakan apa adanya, tanpa garansi. Menjalankan agent trading otonom membawa risiko finansial nyata — kamu bisa kehilangan dana. Selalu mulai dengan `DRY_RUN=true` untuk memverifikasi perilaku sebelum live. Jangan pernah men-deploy modal lebih dari yang kamu mampu untuk kehilangan. Ini bukan saran finansial.

Penulis tidak bertanggung jawab atas kerugian apapun yang timbul dari penggunaan software ini.
