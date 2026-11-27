export type PieceColor = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Piece {
  color: PieceColor;
  type: PieceType;
  promoted?: boolean; // Used in Crazyhouse so captured promoted pieces revert to pawns
}

export type ChessVariant =
  | 'standard'
  | 'chess960'
  | 'kingOfTheHill'
  | 'threeCheck'
  | 'antichess'
  | 'atomic'
  | 'horde'
  | 'racingKings'
  | 'crazyhouse';

export interface VariantInfo {
  id: ChessVariant;
  name: string;
  shortDesc: string;
  rules: string;
}

export interface CastlingRights {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
  // Chess960 rook files (0..7)
  wKingsideRookFile?: number;
  wQueensideRookFile?: number;
  bKingsideRookFile?: number;
  bQueensideRookFile?: number;
}

export interface CrazyhousePockets {
  w: Record<Exclude<PieceType, 'k'>, number>;
  b: Record<Exclude<PieceType, 'k'>, number>;
}

export interface BoardState {
  board: (Piece | null)[][]; // 8x8: row 0 = rank 8, row 7 = rank 1; col 0 = a, col 7 = h
  turn: PieceColor;
  castling: CastlingRights;
  enPassant: [number, number] | null; // [row, col]
  halfmoveClock: number;
  fullmoveNumber: number;
  variant: ChessVariant;
  checksGiven: { w: number; b: number }; // For Three-check
  pockets: CrazyhousePockets; // For Crazyhouse
  kingStartFile?: number; // For Chess960
}

export interface Move {
  from: [number, number] | null; // null if Crazyhouse drop
  to: [number, number];
  piece: PieceType;
  color: PieceColor;
  captured?: PieceType;
  promotion?: PieceType;
  isEnPassant?: boolean;
  isCastle?: 'K' | 'Q';
  isDrop?: boolean;
  san?: string;
  uci?: string;
}

export type GameStatus =
  | 'ongoing'
  | 'checkmate'
  | 'stalemate'
  | 'draw_repetition'
  | 'draw_50move'
  | 'draw_insufficient'
  | 'draw_agreement'
  | 'resigned'
  | 'timeout'
  | 'aborted'
  | 'variant_win';

export interface GameResult {
  status: GameStatus;
  winner: PieceColor | 'draw' | null;
  reason: string;
}

export interface AnalyzedMove {
  ply: number;
  san: string;
  uci: string;
  fenBefore: string;
  fenAfter: string;
  evalBefore: number; // centipawns from White's perspective
  evalAfter: number;
  bestMoveSan: string;
  bestMoveUci: string;
  cpLoss: number;
  classification: 'Best' | 'Great' | 'Good' | 'Inaccuracy' | 'Mistake' | 'Blunder';
}

export interface GameRecord {
  id: string;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  variant: ChessVariant;
  timeControl: string;
  result: '1-0' | '0-1' | '1/2-1/2';
  reason: string;
  date: string;
  moves: Move[];
  fens: string[];
  pgn: string;
  openingEco?: string;
  openingName?: string;
  userColor?: PieceColor;
  accuracy?: { w: number; b: number };
  acpl?: { w: number; b: number };
  analysis?: AnalyzedMove[];
}

export interface ConditionalPremove {
  id: string;
  ifOpponentSan: string;
  thenMySan: string;
}

export interface CorrespondenceGame {
  id: string;
  opponent: string;
  opponentElo: number;
  userColor: PieceColor;
  variant: ChessVariant;
  daysPerMove: number;
  lastMoveAt: number;
  state: BoardState;
  moves: Move[];
  fens: string[];
  conditionals: ConditionalPremove[];
  status: GameResult | null;
}

export interface BoardAnnotation {
  arrows: { from: string; to: string; color: string }[];
  squares: { square: string; color: string }[];
}

export interface StudyChapter {
  id: string;
  title: string;
  initialFen: string;
  variant: ChessVariant;
  moves: Move[];
  fens: string[];
  comments: Record<number, string>; // ply -> text comment
  nags: Record<number, string>; // ply -> '!' | '?' | '!!' | '!?' | '?!' | '??'
  annotations: Record<number, BoardAnnotation>; // ply -> drawings
}

export interface Study {
  id: string;
  title: string;
  author: string;
  description: string;
  updatedAt: number;
  chapters: StudyChapter[];
}

export interface Puzzle {
  id: string;
  title: string;
  rating: number;
  themes: string[];
  fen: string;
  solutionUci: string[]; // Alternating player move, opponent reply, player move...
  playerColor: PieceColor;
  source?: string; // e.g. 'Curated' or 'From Your Game'
}

export interface LessonStep {
  id: string;
  title: string;
  instruction: string;
  fen: string;
  targetSquares: string[]; // Squares to reach or capture
  solutionUci: string[];
  hint: string;
}

export interface LessonModule {
  id: string;
  category: 'Fundamentals' | 'Checkmates' | 'Tactics' | 'Special Rules';
  title: string;
  summary: string;
  steps: LessonStep[];
}

export interface TournamentPlayer {
  id: string;
  name: string;
  rating: number;
  score: number;
  streak: number;
  gamesPlayed: number;
  buchholz?: number;
  team?: string;
  title?: string;
  isBot?: boolean;
  isUser?: boolean;
}

export type PlanTier = 'free' | 'pro' | 'max';

export type PaymentMethod = 'upi' | 'netbanking' | 'card' | 'razorpay';

export interface DailyQuotaUsage {
  date: string;
  analysisUsed: number;
  puzzlesUsed: number;
}

export interface PaymentOrderInfo {
  orderId: string;
  orderToken: string;
  plan: Exclude<PlanTier, 'free'>;
  amountInr: number;
  currency: 'INR';
  provider: 'stripe' | 'razorpay' | 'sandbox';
  razorpayOrderId?: string;
  razorpayKeyId?: string;
  razorpayMode?: 'live' | 'test';
  checkoutUrl?: string;
}

export interface PaymentReceipt {
  receiptId: string;
  orderId: string;
  plan: Exclude<PlanTier, 'free'>;
  amountInr: number;
  currency: 'INR';
  method: PaymentMethod;
  methodLabel: string;
  status: 'paid';
  paidAt: string;
  razorpayPaymentId?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  rating: number;
  createdAt: string;
  plan?: PlanTier;
  quota?: DailyQuotaUsage;
  isBot?: boolean;
}

export interface Tournament {
  id: string;
  name: string;
  format: 'arena' | 'swiss';
  isTeamBattle?: boolean;
  variant: ChessVariant;
  timeControl: string;
  durationMinutes?: number; // Arena
  totalRounds?: number; // Swiss
  currentRound: number;
  status: 'upcoming' | 'active' | 'finished';
  players: TournamentPlayer[];
  joined: boolean;
  ownerId?: string;
  createdBy?: string;
}

export interface Team {
  id: string;
  name: string;
  members: number;
  location: string;
  description: string;
  joined: boolean;
  leader: string;
}

export interface ForumPost {
  id: string;
  category: 'General' | 'Game Analysis' | 'Variants' | 'Feedback' | 'Blog';
  title: string;
  author: string;
  createdAt: string;
  body: string;
  replies: { id: string; author: string; text: string; createdAt: string }[];
  isBlog?: boolean;
}

export interface Friend {
  id: string;
  name: string;
  rating: number;
  title?: string;
  online: boolean;
  bio: string;
}

export interface DirectMessage {
  id: string;
  friendId: string;
  sender: 'me' | 'them';
  text: string;
  timestamp: string;
}

export type ThemeMode = 'light' | 'dark';
export type BoardThemeId =
  | 'wood'
  | 'green'
  | 'blue'
  | 'walnut'
  | 'coral'
  | 'monochrome'
  | 'emerald'
  | 'midnight'
  | 'rosewood'
  | 'glass';
export type PieceSetId = 'classic' | 'neo' | 'alpha' | 'minimal';
export type BgThemeId = 'clean' | 'warm-linen' | 'obsidian-grid' | 'forest-slate';
export type SoundThemeId = 'standard' | 'wood' | 'futuristic' | 'retro' | 'shogi';
export type MoveMethodId = 'both' | 'click' | 'drag';

export type RatingCategory = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'chess960';

export interface UserRatings {
  bullet: number;
  blitz: number;
  rapid: number;
  classical: number;
  chess960: number;
  history: { date: string; category: RatingCategory; rating: number }[];
}

export interface LiveGameSummary {
  roomId: string;
  variant: ChessVariant;
  timeControl: string;
  whiteName: string;
  whiteIsGuest: boolean;
  blackName: string;
  blackIsGuest: boolean;
  fen: string;
  moveCount: number;
  spectatorCount: number;
  status: 'waiting' | 'active' | 'finished';
}

export interface ClubInfo {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  memberCount: number;
  members: string[];
  totalScore: number;
}

export interface HallOfFameEntry {
  id: string;
  tournamentId: string;
  tournamentName: string;
  format: 'arena' | 'swiss' | 'knockout';
  completedAt: string;
  podium: { rank: 1 | 2 | 3; name: string; isGuest?: boolean; score: number }[];
}

export type LanguageCode =
  | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'it' | 'ru' | 'ja' | 'zh' | 'hi'
  | 'ar' | 'pl' | 'nl' | 'tr' | 'ko' | 'sv' | 'no' | 'cs' | 'uk' | 'el';

export interface UserPreferences {
  theme: ThemeMode;
  boardTheme: BoardThemeId;
  pieceSet: PieceSetId;
  bgTheme: BgThemeId;
  language: LanguageCode;
  soundEnabled: boolean;
  soundTheme?: SoundThemeId;
  voiceEnabled?: boolean;
  showCoordinates: boolean;
  highlightLegalMoves: boolean;
  showLastMove?: boolean;
  blindfoldPieces?: boolean;
  pieceScale?: 'normal' | 'large';
  autoQueen?: boolean;
  confirmMove?: boolean;
  moveMethod?: MoveMethodId;
  showRatings?: boolean;
  isBot?: boolean;
  username: string;
}

