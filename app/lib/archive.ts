import { importRecords, listRecords, saveRecord } from "../planner/record-store";

export type Story = {
  id: string;
  title: string;
  date: string; // Empty string means the date was deliberately not selected.
  category: "life" | "work";
  body: string;
  summary?: string;
  facts?: { label: string; value: string }[];
  images: string[];
  parentId: string | null;
};

export const sampleStories: Story[] = [
  { id: "beginning", title: "모든 게 처음이던 날들", date: "2002-05-05", category: "life", images: ["/images/childhood.jpg"], parentId: null, body: "세상이 온통 놀이터 같았던 시절. 작은 것 하나에도 한참을 웃고, 처음 보는 풍경 앞에서는 오래도록 발걸음을 멈췄다.\n\n그때의 호기심이 어쩌면 지금의 나를 만들었는지도 모르겠다. 무엇이든 직접 보고, 만지고, 만들어 보고 싶었던 마음. 그 마음만큼은 오래 간직하고 싶다." },
  { id: "summer", title: "여름을 기억하는 방법", date: "2009-08-12", category: "life", images: ["/images/sea.jpg"], parentId: null, body: "바다 냄새와 뜨거운 모래, 해가 질 때까지 돌아오지 않던 우리.\n\n특별한 일이 없어도 오래 남는 날이 있다. 사진 밖의 바람과 소리까지 기억하고 싶어서, 그날부터 조금씩 순간들을 남기기 시작했다." },
  { id: "camera", title: "나만의 시선을 찾다", date: "2014-03-21", category: "work", images: ["/images/camera.jpg"], parentId: "summer", body: "처음 카메라를 손에 쥐었다. 같은 길을 걸어도 렌즈 너머로 보면 전혀 다른 풍경이었다.\n\n무엇을 담을지보다 무엇을 바라보는 사람인지가 더 중요하다는 걸 배웠다. 서툴지만 온전히 내 시선으로 남긴 첫 번째 작업." },
  { id: "city", title: "익숙한 곳을 떠나", date: "2018-02-24", category: "life", images: ["/images/city.jpg"], parentId: null, body: "낯선 도시에서 시작한 새로운 생활. 기대보다 걱정이 조금 더 컸지만, 그만큼 세상은 넓어졌다.\n\n혼자 걷는 길이 많아지면서 내가 좋아하는 것과 나에게 필요한 것들을 천천히 알아갔다." },
  { id: "work", title: "좋아하는 일을, 나의 일로", date: "2021-06-14", category: "work", images: ["/images/desk.jpg"], parentId: "camera", body: "머릿속에만 있던 생각이 눈앞의 결과물이 되는 순간을 좋아한다.\n\n작은 아이디어를 스케치하고, 만들고, 다시 고치는 일. 수없이 돌아가는 것처럼 보여도 그 과정 안에서 내 방식이 조금씩 생겨났다. 이것은 그 시작을 기록한 첫 프로젝트다." },
  { id: "mountain", title: "조금 느려도 괜찮아", date: "2023-10-07", category: "life", images: ["/images/mountain.jpg"], parentId: null, body: "계속 앞으로 가야 한다고 생각했다. 잠시 멈춰 뒤돌아보니 꽤 먼 길을 와 있었다.\n\n산을 오르던 날 배운 것. 빠르게 가는 것보다 나의 호흡으로 계속 걷는 일이 중요하다는 것." },
  { id: "today", title: "그리고, 이어지는 이야기", date: "2026-10-26", category: "life", images: ["/images/light.jpg"], parentId: null, body: "지나온 순간들을 연결해 보니 하나의 이야기가 되었다. 서로 상관없어 보이던 선택들도 지금의 나에게 닿아 있다.\n\n아직 채우지 않은 다음 장이 있다. 어떤 장면으로 이어질지는 모르지만, 나답게 기록해 보려고 한다." },
];

// IndexedDB is consulted only to migrate records from earlier releases.
async function legacyStories(): Promise<Story[] | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("sesasi-archive", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("archive");
    request.onerror = () => reject(new Error("이전 기록을 불러오지 못했어요. 기존 데이터는 보존했습니다."));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("archive", "readonly");
      const read = tx.objectStore("archive").get("stories");
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  });
}
let archiveRevision = 0;
export async function readStories(): Promise<Story[]> {
  let rows = await listRecords<Story[]>("archive");
  let row = rows.find(row => row.key === "stories");
  if (!row) {
    const legacy = await legacyStories();
    if (legacy !== undefined && !validateStories(legacy)) throw new Error("이전 기록의 형식을 확인하지 못했어요. 기존 데이터는 보존했습니다.");
    await importRecords("archive", [{ key: "stories", value: legacy ?? sampleStories }]);
    rows = await listRecords<Story[]>("archive");
    row = rows.find(row => row.key === "stories");
  }
  if (!row || !validateStories(row.value)) throw new Error("서버 기록을 확인하지 못했습니다.");
  archiveRevision = row.revision;
  return row.value;
}
export async function writeStories(stories: Story[]) {
  if (!validateStories(stories)) throw new Error("기록의 형식을 확인해 주세요.");
  archiveRevision = await saveRecord("archive", "stories", stories, archiveRevision);
}
export function hasChronologicalDates(stories: Story[]): boolean {
  const byId = new Map(stories.map(story => [story.id, story]));
  return stories.every(story => {
    const visited = new Set([story.id]);
    let parentId = story.parentId;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent || visited.has(parentId)) return false;
      if (story.date && parent.date && parent.date > story.date) return false;
      visited.add(parentId);
      parentId = parent.parentId;
    }
    return true;
  });
}

export function sortStories(stories: Story[]): Story[] {
  const byId = new Map(stories.map(story => [story.id, story]));
  const undatedChildren = new Map<string, Story[]>();
  for (const story of stories) {
    if (!story.date && story.parentId) {
      const siblings = undatedChildren.get(story.parentId) ?? [];
      siblings.push(story);
      undatedChildren.set(story.parentId, siblings);
    }
  }
  const result: Story[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const append = (story: Story) => {
    if (visited.has(story.id) || visiting.has(story.id)) return;
    visiting.add(story.id);
    const parent = story.parentId ? byId.get(story.parentId) : undefined;
    if (parent) append(parent);
    visiting.delete(story.id);
    visited.add(story.id);
    result.push(story);
    for (const child of undatedChildren.get(story.id) ?? []) append(child);
  };
  // Undated branches follow their parent; independent undated records go last.
  [...stories].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || (a.date && b.date ? a.id.localeCompare(b.id) : 0)).forEach(append);
  return result;
}

export function validateStories(value: unknown): value is Story[] {
  if (!Array.isArray(value) || value.length > 1000) return false;
  const ids = new Set<string>();
  for (const s of value) {
    if (!s || typeof s.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(s.id) || ids.has(s.id) || typeof s.title !== "string" || !s.title.trim() || typeof s.body !== "string" || typeof s.date !== "string" || (s.date !== "" && (!/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !Number.isFinite(Date.parse(s.date)))) || !["life", "work"].includes(s.category) || !Array.isArray(s.images) || !s.images.every((i: unknown) => typeof i === "string" && (/^data:image\/(jpeg|png|webp);base64,/.test(i) || /^\/images\/[a-z]+\.jpg$/.test(i))) || !(s.parentId === null || typeof s.parentId === "string")) return false;
    if (s.summary !== undefined && (typeof s.summary !== "string" || s.summary.length > 240)) return false;
    if (s.facts !== undefined && (!Array.isArray(s.facts) || s.facts.length > 6 || !s.facts.every((fact: unknown) => {
      if (!fact || typeof fact !== "object" || Array.isArray(fact)) return false;
      const item = fact as Record<string, unknown>;
      return typeof item.label === "string" && item.label.length <= 32 && typeof item.value === "string" && item.value.length <= 160;
    }))) return false;
    ids.add(s.id);
  }
  return hasChronologicalDates(value);
}
export async function imageData(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("JPG, PNG, WebP 이미지를 선택해 주세요.");
  if (file.size > 20 * 1024 * 1024) throw new Error("이미지는 한 장당 20MB 이하로 선택해 주세요.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지를 처리할 수 없습니다.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // Keep alpha channels in artwork; PNG ignores the lossy quality argument.
  return canvas.toDataURL(file.type, 0.86);
}
