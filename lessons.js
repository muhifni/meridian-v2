import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./logger.js";
import { getSharedLessonsForPrompt, pushHiveLesson, pushHivePerformanceEvent } from "./hivemind.js";
import { initializeLessonScore, applyPerformanceFeedback, pruneLessons, runMaintenance } from "./utils/lessonManager.js";