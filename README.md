## Pakai LLM Lain (SwiftRouter dll)

Meridian bisa pakai banyak LLM, bukan cuma OpenRouter.

### Cara Paling Mudah
Jalankan:
```bash
npm run setup
```
Lalu pilih **SwiftRouter** saat ditanya.

### Cara Manual
Tambahkan di file `.env`:

```env
LLM_BASE_URL=https://api.swiftrouter.com/v1
LLM_API_KEY=sk-isi-api-key-mu
LLM_MODEL=claude-sonnet-4-6
```

### Lihat Model yang Tersedia
```bash
# Lihat semua model
meridian models --provider swiftrouter

# Hanya lihat model yang bagus untuk tool calling
meridian models --provider swiftrouter --tool-calling
```

**Rekomendasi model bagus:**
- `claude-sonnet-4-6` (paling direkomendasikan)
- `gemini-2.5-pro`
- `deepseek-r1-0528`

Kami sudah membuat Meridian lebih stabil saat pakai berbagai provider.