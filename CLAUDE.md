## Maintaining CHANGELOG.md

Untuk menjaga riwayat perubahan yang rapi, ikuti panduan sederhana ini:

### Kapan Harus Update CHANGELOG?
- Setiap kali menambahkan fitur baru yang signifikan
- Setelah memperbaiki bug penting
- Sebelum merilis versi baru

### Format yang Dipakai
Ikuti struktur yang sudah ada di `CHANGELOG.md`:

```markdown
## [Unreleased]

### Added
- Fitur baru

### Changed
- Perubahan pada fitur lama

### Fixed
- Perbaikan bug
```

### Aturan Versioning (Semantic Versioning)

| Jenis Perubahan              | Contoh          | Keterangan |
|-----------------------------|------------------|----------|
| **Patch** (`1.0.0` → `1.0.1`) | Perbaikan bug kecil | Tidak menambah fitur |
| **Minor** (`1.0.0` → `1.1.0`) | Menambah fitur baru | Backward compatible |
| **Major** (`1.0.0` → `2.0.0`) | Perubahan besar     | Bisa merusak kompatibilitas lama |

### Langkah Update Saat Release

1. Pindahkan semua perubahan dari bagian `[Unreleased]` ke versi baru.
2. Buat header versi baru di atas, contoh:
   ```markdown
   ## [1.2.0] - 2026-05-20
   ```
3. Update versi di `package.json` sesuai aturan di atas.
4. Commit dengan pesan yang jelas, contoh:
   - `chore: release v1.2.0`
   - `docs: update changelog for v1.2.0`

### Tips
- Selalu tulis perubahan dari sudut pandang **pengguna**, bukan developer.
- Gunakan bahasa yang jelas dan singkat.
- Jika ragu, lebih baik tulis dulu di `[Unreleased]`, nanti dirapikan saat release.

