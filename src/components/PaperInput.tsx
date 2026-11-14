import { useId } from 'react';

interface PaperInputProps {
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  readOnly?: boolean;
}

export function PaperInput({ confirmed, onConfirmedChange, readOnly = false }: PaperInputProps) {
  const descriptionId = useId();
  return (
    <section aria-label="Paper writing input">
      <p id={descriptionId}>
        Write your answer on paper, then confirm your attempt before comparing.
      </p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={readOnly}
          aria-describedby={descriptionId}
          onChange={(event) => {
            onConfirmedChange(event.target.checked);
          }}
        />
        I wrote it on paper
      </label>
    </section>
  );
}
