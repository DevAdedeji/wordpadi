import { Check, X } from 'lucide-react';
import type { WordScore } from '@word-lagos/game-core';
/** A single outline wraps the complete word, including previously played tiles. */
export default function WordFeedback({
  words,
  opponent,
  total,
}: {
  words: WordScore[];
  opponent?: string;
  total?: number;
}) {
  return (
    <div
      className="board-word-feedback"
      aria-label={opponent ? `${opponent}’s last move, ${total} points` : 'Word validation'}
    >
      {words.map((word, index) => {
        const first = word.cells[0],
          last = word.cells.at(-1)!;
        return (
          <div
            key={`${first.row}-${first.col}-${last.row}-${last.col}`}
            className={`word-outline ${opponent ? 'word-opponent' : word.valid ? 'word-valid' : 'word-invalid'}`}
            style={{
              left: `${(first.col / 15) * 100}%`,
              top: `${(first.row / 15) * 100}%`,
              width: `${((last.col - first.col + 1) / 15) * 100}%`,
              height: `${((last.row - first.row + 1) / 15) * 100}%`,
            }}
            aria-label={`${word.word}: ${word.valid ? 'valid' : 'invalid'}, ${word.score} ${word.valid ? 'points' : 'potential points'}`}
          >
            <span className="word-status-marker">
              {word.valid ? <Check size={12} /> : <X size={12} />}
            </span>
            {(total === undefined || index === 0) && (
              <span
                className="word-points-marker"
                aria-label={`${total ?? word.score} ${total === undefined ? 'word' : 'total'} points`}
                style={{
                  right: last.col === 14 ? 0 : undefined,
                  bottom: last.row === 14 ? 0 : undefined,
                }}
              >
                {total ?? word.score}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
