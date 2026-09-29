import { nowIso } from "./db.js";
import { hashPassword } from "./security.js";

// 种子数据：双班、两种角色、可区分的材料标题，用于验收班级隔离与角色权限。
const CLASSES = ["高一(1)班", "高一(2)班"];

const MATERIALS = [
  {
    classIndex: 0,
    title: "1班-函数与导数复习提纲",
    body: "本材料属于高一(1)班：函数定义域、单调性与导数应用的复习提纲。班级标识 CLASS-1。",
    filename: "class1-functions.md"
  },
  {
    classIndex: 0,
    title: "1班-期中文言文整理",
    body: "本材料属于高一(1)班：文言实词与句式整理。班级标识 CLASS-1。",
    filename: "class1-classical-chinese.md"
  },
  {
    classIndex: 1,
    title: "2班-函数与导数复习提纲",
    body: "本材料属于高一(2)班：函数定义域、单调性与导数应用的复习提纲。班级标识 CLASS-2。",
    filename: "class2-functions.md"
  },
  {
    classIndex: 1,
    title: "2班-期中文言文整理",
    body: "本材料属于高一(2)班：文言实词与句式整理。班级标识 CLASS-2。",
    filename: "class2-classical-chinese.md"
  }
];

export function seedDatabase(db, config, options = {}) {
  const force = options.force === true;
  const existing = db.prepare("SELECT COUNT(*) AS n FROM users").get();
  if (Number(existing.n) > 0 && !force) {
    return { seeded: false };
  }

  if (!config.seedTeacherPassword || !config.seedStudentPassword) {
    const err = new Error(
      "[seed] 缺少 SEED_TEACHER_PASSWORD / SEED_STUDENT_PASSWORD，拒绝使用内置默认口令。请在 .env 中设置（参考 .env.example）。"
    );
    err.code = "SEED_PASSWORD_MISSING";
    throw err;
  }

  if (force) {
    db.exec("DELETE FROM sessions; DELETE FROM materials; DELETE FROM users; DELETE FROM classes; DELETE FROM login_attempts;");
  }

  const now = nowIso();
  const insertClass = db.prepare("INSERT INTO classes (name, created_at) VALUES (?, ?)");
  const classIds = CLASSES.map((name) => Number(insertClass.run(name, now).lastInsertRowid));

  const insertUser = db.prepare(
    "INSERT INTO users (username, display_name, role, class_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const teacherHash = hashPassword(config.seedTeacherPassword);
  const studentHash = hashPassword(config.seedStudentPassword);

  const users = [
    ["teacher01", "王老师", "teacher", classIds[0], teacherHash],
    ["student01", "李同学", "student", classIds[0], studentHash],
    ["teacher02", "赵老师", "teacher", classIds[1], teacherHash],
    ["student02", "陈同学", "student", classIds[1], studentHash]
  ];
  const userIds = new Map();
  for (const [username, displayName, role, classId, hash] of users) {
    insertUser.run(username, displayName, role, classId, hash, now);
    userIds.set(username, db.prepare("SELECT id FROM users WHERE username = ?").get(username).id);
  }

  const insertMaterial = db.prepare(
    "INSERT INTO materials (class_id, title, body, filename, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  // 与上传链路一致：材料表与知识库表成对写入
  const insertEntry = db.prepare(
    "INSERT INTO knowledge_entries (material_id, class_id, title, body, source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const item of MATERIALS) {
    const uploader = item.classIndex === 0 ? userIds.get("teacher01") : userIds.get("teacher02");
    const info = insertMaterial.run(classIds[item.classIndex], item.title, item.body, item.filename, uploader, now);
    insertEntry.run(Number(info.lastInsertRowid), classIds[item.classIndex], item.title, item.body, item.filename, now);
  }

  return { seeded: true, classes: CLASSES.length, users: users.length, materials: MATERIALS.length };
}

export { CLASSES, MATERIALS };
