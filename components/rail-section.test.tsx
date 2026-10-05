import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RailSection } from '@/components/rail-section';

describe('A section of the document rail', () => {
  it('shows its content until the reader folds it away', async () => {
    render(
      <RailSection title="Details">
        <p>Uploaded yesterday</p>
      </RailSection>
    );

    const heading = screen.getByRole('button', { name: /details/i });
    expect(heading).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Uploaded yesterday')).toBeVisible();

    await userEvent.click(heading);

    expect(heading).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Uploaded yesterday')).not.toBeInTheDocument();
  });

  it('says how many items it holds when given a count', () => {
    render(
      <RailSection title="Activity" count={3}>
        <p>jobs</p>
      </RailSection>
    );

    expect(screen.getByRole('button', { name: /activity\s*3/i })).toBeInTheDocument();
  });
});
