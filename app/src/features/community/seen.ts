/**
 * The celebration cards a person has seen on this device (community.md §3 step 3): a card's
 * confetti bursts the first time each person sees it here, and not again. Kept per person,
 * the newest 200; storage that is blocked or cleared only means a card bursts once more.
 */
const KEY = "mc-celebrations-seen";
const KEEP = 200;

const keyOf = (userId: string | null | undefined) => `${KEY}:${userId ?? "anyone"}`;

function read(userId: string | null | undefined): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(keyOf(userId)) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function cardSeen(cardId: string, userId: string | null | undefined): boolean {
  return read(userId).includes(cardId);
}

export function markCardSeen(cardId: string, userId: string | null | undefined): void {
  try {
    const ids = read(userId).filter((id) => id !== cardId);
    ids.push(cardId);
    localStorage.setItem(keyOf(userId), JSON.stringify(ids.slice(-KEEP)));
  } catch {
    /* storage can be blocked: the card bursts again next time */
  }
}
