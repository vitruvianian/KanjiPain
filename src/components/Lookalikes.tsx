import { Link } from 'react-router-dom';

import type { KanjiId } from '../domain/types';

export interface LookalikeItem {
  readonly id: KanjiId;
  readonly literal: string;
  readonly meaning: string | undefined;
}

interface LookalikesProps {
  readonly items: readonly LookalikeItem[];
  readonly headingLevel?: 2 | 3;
  /** Link each look-alike to its character page. Off during practice. */
  readonly linked?: boolean;
}

/** Characters whose written shape is easily confused with this one. */
export function Lookalikes({ items, headingLevel = 3, linked = false }: LookalikesProps) {
  if (items.length === 0) return null;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className="lookalikes">
      <Heading>Don&apos;t confuse it with</Heading>
      <ul>
        {items.map((item) => {
          const glyph = (
            <span className="lookalikes__glyph" lang="ja">
              {item.literal}
            </span>
          );
          return (
            <li key={item.id}>
              {linked ? <Link to={`/kanji/${item.id}`}>{glyph}</Link> : glyph}
              {item.meaning === undefined ? null : <span className="muted">{item.meaning}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
