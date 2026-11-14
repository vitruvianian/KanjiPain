/** Shown wherever a character has no stroke data, so nothing can be guided or checked. */
export const UNRECOGNIZED_MESSAGE =
  'Not recognized: stroke order and automatic checking are not available for this character. You will grade your drawings yourself.';

export function UnrecognizedWarning() {
  return (
    <div className="banner banner--warning" role="note">
      <p>{UNRECOGNIZED_MESSAGE}</p>
    </div>
  );
}
