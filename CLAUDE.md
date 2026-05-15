# Meridian — CLAUDE.md

... (existing content)

## Lesson Scoring & Auto-Pruning (v1.2.0+)

Baru ditambahkan `utils/lessonManager.js`:

- `initializeLessonScore(lesson, outcome)` — beri score awal
- `applyPerformanceFeedback(perf)` — update score lesson berdasarkan outcome posisi berikutnya
- `pruneLessons()` — hapus otomatis lesson score rendah / lama
- `runMaintenance()` — panggil periodic (setiap ~8 closes)

Integrasi sudah ada di `lessons.js` (recordPerformance).

Pelajaran sekarang punya feedback loop → semakin "pintar" seiring waktu (sesuai konsep Swarm Intelligence).