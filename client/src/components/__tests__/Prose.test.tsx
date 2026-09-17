import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Prose } from '../Prose';

describe('Prose', () => {
  it('renders headings, lists, bold and https links as elements', () => {
    render(<Prose text={'## Starter\n\nFeed it **daily** and _gently_.\n\n- Flour\n- Water\n\nSee [the guide](https://example.com/guide).'} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Starter' })).toBeInTheDocument();
    expect(screen.getByText('daily').tagName).toBe('STRONG');
    expect(screen.getByText('gently').tagName).toBe('EM');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Flour', 'Water']);
    const link = screen.getByRole('link', { name: 'the guide' });
    expect(link).toHaveAttribute('href', 'https://example.com/guide');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('never turns text into HTML and ignores non-http links', () => {
    const { container } = render(<Prose text={'<img src=x onerror=alert(1)> and [x](javascript:alert(1))'} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
