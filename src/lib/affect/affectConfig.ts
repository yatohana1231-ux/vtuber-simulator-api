// -------------------------------------------------------
// 感情・関係値のモデル（D-040）の設定値
//
// 数値に関わる設定値の既定値を、この1か所に集める。キャラクターごとの違いは
// content/characters/*.json の bigFive・affectTuning で表し、personality.ts の
// resolveAffectProfile が AffectProfile にまとめる。
//
// 値はどれも仮のもので、perceptionGrowthSimulation.ts の試算と AI 応答テストで調整する
// （.notes/affect-model-redesign-roadmap.md のフェーズ15・16）。
// 情動ごとの PAD 座標は ALMA（Gebhard 2005）の表を参考にした仮の値（原典の値は未確認）。
// -------------------------------------------------------

import type { AttachmentStyle, CharacterGoal, EmotionKey, MoodPad, Perception } from "../../types.js";

export interface AffectConfig {
  emotion: {
    /** 情動ごとの半減期（時間）。悲しみは長く、安堵・驚きに近いものは短い */
    halfLifeHours: Record<EmotionKey, number>;
    /** この強さ以上の情動を「活動中」として、プロンプトと気分の押し引きに使う */
    activeThreshold: number;
    /** 望ましさ・称賛の値（絶対値1〜3）の1点あたりの強さ */
    intensityPerPoint: number;
    /** relatedGoalKey が無い・見つからない出来事に使う重要度（1〜100） */
    defaultGoalImportance: number;
    /** 神経症傾向 +100 のときに、負の情動の強さに足す倍率（-100 なら引く） */
    neuroticismNegativeGain: number;
    /** 外向性 +100 のときに、正の情動の強さに足す倍率（-100 なら引く） */
    extraversionPositiveGain: number;
    /** 情動ごとの PAD 座標（各 -100〜+100）。気分の押し引きの向きを決める */
    pad: Record<EmotionKey, MoodPad>;
  };
  mood: {
    /** 気分が平常値へ戻る半減期（時間） */
    halfLifeHours: number;
    /** 押し引きの1回の幅（情動の中心の強さ 100 のときに動く距離） */
    pullPushStepAtFullIntensity: number;
    /** 疲労 100 のときに、平常値の覚醒に足す量（負） */
    arousalOffsetAtFullFatigue: number;
    /** 孤独感 100 のときに、平常値の快に足す量（負） */
    pleasureOffsetAtFullLoneliness: number;
    /** 原点からの距離がこれ未満なら「ふつう」（象限の名前を付けない） */
    neutralRadius: number;
    /** 強さの3段階の境目（原点からの距離）。moderate 未満は「少し」、strong 以上は「とても」 */
    strengthThresholds: { moderate: number; strong: number };
  };
  needs: {
    /** 会っていない間に、1日あたり孤独感が増える量の基準（ほかの係数をかける前） */
    lonelinessGrowthPerDay: number;
    /** 孤独感が時間で増える上限 */
    lonelinessMaxFromAbsence: number;
    /** プレイヤーの発言1回で孤独感が減る量 */
    lonelinessReliefPerMessage: number;
    /** 最初の段階での孤独感の増え方の係数（最後の段階は 1。間は直線で補う） */
    lonelinessFirstStageFactor: number;
    /** dependence（1〜100）による係数の範囲。dependence 1 で min、100 で max */
    lonelinessDependenceFactor: { min: number; max: number };
    /** 愛着のスタイルごとの係数 */
    lonelinessAttachmentFactor: Record<AttachmentStyle, number>;
    /** 疲労の計算でさかのぼる時間（この時点の疲労を fatigueBaseline として積み上げる） */
    fatigueLookbackHours: number;
    fatigueBaseline: number;
  };
  perception: {
    /** セッションの終わりとみなす、発言の間隔（分） */
    sessionGapMinutes: number;
    /**
     * 関係値の上がりやすさの全体の倍率（正の差分にかける。キャラクターごとの perceptionGainScale とは別）。
     * 関係が深まるペースを決める。0.8 は「毎日1回ふつうに話して、最後の段階まで約3か月
     * （各段階およそ1か月）」になる値（2026-09-19 の試算。ユーザーの指示）
     */
    gainScale: number;
    /** 負の寄与にかける重み（正は 1）。控えめにする（D-040・D-033） */
    negativeWeight: number;
    /** 釣り鐘の減衰の幅の既定値（段階の範囲の中での位置 p にかける。exp(-p^2 / (2σ^2))） */
    dampingSigma: number;
    /** 発言1回あたりの寄与の基準（セッションの終わりに peak と last の平均を反映する） */
    contribution: {
      /** affection: プレイヤーが原因の情動の強さ 100 あたり */
      affectionPerPlayerCausedEmotion: number;
      /** trust */
      trustResponsive: number;
      trustDismissive: number;
      trustRememberedPastTopic: number;
      trustPerGratitude: number; // 感謝の強さ 100 あたり
      /** respect: 感心の強さ 100 あたり */
      respectPerAdmiration: number;
      /** fear: プレイヤーが原因の怒り・悲しみの強さ 100 あたり（fearNegativeEmotionThreshold 以上のときだけ） */
      fearPerPlayerCausedNegativeEmotion: number;
      fearNegativeEmotionThreshold: number;
      /** fear: プレイヤーが原因の正の情動があった発言で下がる量 */
      fearReliefPerPositiveMessage: number;
      /** dependence */
      dependenceHelped: number;
      /** 最初の段階での dependence の上がりやすさの係数（最後の段階は 1） */
      dependenceFirstStageFactor: number;
      /** familiarity */
      familiarityPerMessage: number;
      familiarityFactDisclosure: number;
      familiarityEmotionDisclosure: number;
    };
    /** 話さない日がこの日数を超えたら、familiarity が1日あたり familiarityDecayPerDay ずつ下がる */
    familiarityDecayAfterDays: number;
    familiarityDecayPerDay: number;
  };
  memory: {
    /** 気分一致の記憶へのボーナス（スコアにかける倍率の上乗せ。気分の快の絶対値 100 のとき） */
    moodCongruenceBonusAtFullPleasure: number;
  };
}

export const DEFAULT_AFFECT_CONFIG: AffectConfig = {
  emotion: {
    halfLifeHours: {
      joy: 4,
      sadness: 12,
      hope: 8,
      anxiety: 8,
      relief: 2,
      disappointment: 6,
      pride: 6,
      shame: 8,
      gratitude: 4,
      admiration: 3,
      anger: 4,
      happyFor: 3,
      sympathy: 4,
    },
    activeThreshold: 15,
    intensityPerPoint: 20,
    defaultGoalImportance: 50,
    neuroticismNegativeGain: 0.5,
    extraversionPositiveGain: 0.3,
    pad: {
      joy: { pleasure: 40, arousal: 20, dominance: 10 },
      sadness: { pleasure: -40, arousal: -20, dominance: -50 },
      hope: { pleasure: 20, arousal: 20, dominance: -10 },
      anxiety: { pleasure: -64, arousal: 60, dominance: -43 },
      relief: { pleasure: 20, arousal: -30, dominance: 40 },
      disappointment: { pleasure: -30, arousal: 10, dominance: -40 },
      pride: { pleasure: 40, arousal: 30, dominance: 30 },
      shame: { pleasure: -30, arousal: 10, dominance: -60 },
      gratitude: { pleasure: 40, arousal: 20, dominance: -30 },
      admiration: { pleasure: 50, arousal: 30, dominance: -20 },
      anger: { pleasure: -51, arousal: 59, dominance: 25 },
      happyFor: { pleasure: 40, arousal: 20, dominance: 20 },
      sympathy: { pleasure: -40, arousal: -20, dominance: -50 },
    },
  },
  mood: {
    halfLifeHours: 36,
    pullPushStepAtFullIntensity: 20,
    arousalOffsetAtFullFatigue: -40,
    pleasureOffsetAtFullLoneliness: -30,
    neutralRadius: 15,
    strengthThresholds: { moderate: 40, strong: 75 },
  },
  needs: {
    lonelinessGrowthPerDay: 12,
    lonelinessMaxFromAbsence: 90,
    lonelinessReliefPerMessage: 8,
    lonelinessFirstStageFactor: 0.1,
    lonelinessDependenceFactor: { min: 0.5, max: 1.5 },
    lonelinessAttachmentFactor: { secure: 1, anxious: 1.5, avoidant: 0.6 },
    fatigueLookbackHours: 48,
    fatigueBaseline: 30,
  },
  perception: {
    sessionGapMinutes: 30,
    gainScale: 0.8,
    negativeWeight: 1.25,
    dampingSigma: 0.45,
    contribution: {
      affectionPerPlayerCausedEmotion: 4,
      trustResponsive: 3,
      trustDismissive: -3,
      trustRememberedPastTopic: 1.5,
      trustPerGratitude: 2,
      respectPerAdmiration: 3,
      fearPerPlayerCausedNegativeEmotion: 3,
      fearNegativeEmotionThreshold: 50,
      fearReliefPerPositiveMessage: -0.5,
      dependenceHelped: 2.5,
      dependenceFirstStageFactor: 0.3,
      familiarityPerMessage: 1,
      familiarityFactDisclosure: 2,
      familiarityEmotionDisclosure: 3,
    },
    familiarityDecayAfterDays: 30,
    familiarityDecayPerDay: 0.1,
  },
  memory: {
    moodCongruenceBonusAtFullPleasure: 0.3,
  },
};

/**
 * キャラクターごとに解決した設定（personality.ts の resolveAffectProfile が作る）。
 * lib/affect/ の計算は、CharacterDefinition ではなくこの形を受け取る。
 */
export interface AffectProfile {
  moodHomeBase: MoodPad; // 気分の平常値（欲求でずらす前）
  positiveEmotionGain: number; // 正の情動の強さにかける倍率
  negativeEmotionGain: number; // 負の情動の強さにかける倍率
  emotionHalfLifeScale: number;
  moodHalfLifeScale: number;
  lonelinessGrowthScale: number;
  perceptionGainScale: number;
  perceptionDampingSigma: number;
  goals: CharacterGoal[];
  attachmentStyle: AttachmentStyle;
}

/** 関係値の軸の一覧（並び順を固定する） */
export const PERCEPTION_KEYS: ReadonlyArray<keyof Perception> = [
  "trust",
  "affection",
  "respect",
  "fear",
  "dependence",
  "familiarity",
];

/** 正の情動（外向性の感じやすさがかかる。プレイヤーが原因なら affection を上げる） */
export const POSITIVE_EMOTION_KEYS: ReadonlyArray<EmotionKey> = [
  "joy",
  "hope",
  "relief",
  "pride",
  "gratitude",
  "admiration",
  "happyFor",
];

/** 負の情動（神経症傾向の感じやすさがかかる。プレイヤーが原因なら affection を下げる）。sympathy は相手を思う情動なので含めない */
export const NEGATIVE_EMOTION_KEYS: ReadonlyArray<EmotionKey> = [
  "sadness",
  "anxiety",
  "disappointment",
  "shame",
  "anger",
];
