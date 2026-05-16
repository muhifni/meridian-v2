---
inclusion: always
---

# Changelog & README Update Rules

Setiap kali kamu membuat perubahan pada codebase — baik itu bugfix, fitur baru, atau perbaikan kecil — ikuti aturan berikut:

## CHANGELOG.md

**Selalu update** `/media/blackbox/Projects/meridian/CHANGELOG.md` setelah setiap perubahan kode yang di-commit.

Format entry baru:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- Deskripsi fitur baru

### Changed
- Deskripsi perubahan pada fitur yang sudah ada

### Fixed
- Deskripsi bugfix

### Technical
- Detail teknis yang relevan untuk developer
```

Aturan versioning (Semantic Versioning):
- **PATCH** (X.Y.**Z**) — bugfix, perbaikan kecil, perubahan internal tanpa fitur baru
- **MINOR** (X.**Y**.0) — fitur baru yang backward compatible
- **MAJOR** (**X**.0.0) — breaking change atau perombakan arsitektur besar

Contoh perubahan yang **wajib** masuk CHANGELOG:
- Penambahan file baru (module, tool, utility)
- Perubahan behavior agent (screening rules, management rules)
- Perubahan config keys atau defaults
- Penambahan Telegram commands
- Bugfix yang mempengaruhi behavior
- Perubahan API atau integrasi eksternal

Contoh yang **tidak perlu** masuk CHANGELOG:
- Update komentar kode saja
- Rename variabel internal tanpa behavior change
- Update `.gitignore`

## README.md

**Update opsional** — hanya jika perubahan ini penting untuk pengguna baru atau existing user yang perlu tahu.

Tambahkan ke README jika:
- Fitur baru yang user-facing (command baru, behavior baru yang terlihat)
- Perubahan cara setup atau konfigurasi
- Penambahan section arsitektur yang signifikan
- Perubahan Telegram commands

Tidak perlu update README untuk:
- Bugfix internal
- Refactor tanpa behavior change
- Perubahan teknis yang tidak mempengaruhi cara pakai

## Workflow

1. Buat perubahan kode
2. Update CHANGELOG.md dengan entry baru di bagian atas (setelah header `# Changelog`)
3. Jika perlu, update README.md
4. Commit semua sekaligus
