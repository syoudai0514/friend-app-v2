export type Rarity = "NR" | "SR" | "SSR";

export interface PartOption {
  id: string;
  name: string;
  rarity: Rarity;
}

/**
 * キャラの見た目。VRM本体は衣装込みで1ファイル（バリアント）なので、
 * v1のような髪・目・服などパーツ単位の指定は持たない。
 */
export interface Look {
  /** 着せ替え先のVRMバリアントID（衣装込みの見た目まるごと） */
  variantId: string;
  scene: string;
  motionId: string;
}

/** キャラの中身（人格）。会話プロンプトの素になる */
export interface Persona {
  id: string;
  /** キャラ名 */
  name: string;
  /** 一人称 */
  firstPerson: string;
  /** ユーザーの呼び方につける敬称。空文字なら呼び捨て */
  honorific: string;
  /** 口調の指示 */
  speech: string;
  /** 性格の指示 */
  personality: string;
  /** ホーム画面の待機セリフ。{user} がユーザー名に置換される */
  idleLines: string[];
}

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  at: number;
}

/** キャラごとに分けて保存する中身。切り替えても他のキャラの分は消えない */
export interface PersonaSave {
  persona: Persona;
  look: Look;
  /** 好感度。会話するたびに増える */
  affection: number;
  messages: ChatMessage[];
  /** 会話から覚えた要点（好きなもの・約束など）。短い文の一覧 */
  memories: string[];
}

export interface AppState {
  /** 保存データの形式版。v1は1（無ければ1とみなす）、v2は2 */
  schemaVersion: number;
  /** 初回の名前入力が済んでいるか */
  onboarded: boolean;
  /** キャラからの呼ばれ方 */
  userName: string;
  persona: Persona;
  look: Look;
  /** 好感度。会話するたびに増える */
  affection: number;
  messages: ChatMessage[];
  /** 会話から覚えた要点（好きなもの・約束など）。短い文の一覧 */
  memories: string[];
  /** 今えらんでいないキャラの分の保存データ（persona.id をキーにする） */
  personas: Record<string, PersonaSave>;
}

/** 好感度レベル。会話のトーンが段階的に変わる */
export interface AffectionLevel {
  level: number;
  label: string;
  /** このレベルに到達するのに必要な好感度 */
  threshold: number;
  /** プロンプトに差し込む距離感の指示 */
  attitude: string;
}
