import {
  SHARE_CARD_ALT,
  SHARE_CARD_CONTENT_TYPE,
  SHARE_CARD_SIZE,
  renderShareCard,
} from "@/lib/ogImage";

export const alt = SHARE_CARD_ALT;
export const size = SHARE_CARD_SIZE;
export const contentType = SHARE_CARD_CONTENT_TYPE;

export default function OpengraphImage() {
  return renderShareCard();
}
