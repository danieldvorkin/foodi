import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Menu, Sheet } from '../ui';

describe('Menu', () => {
  it('opens on click, closes on Escape, outside click, and item activation', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">elsewhere</button>
        <Menu label="Account" button={<span>me</span>}>
          <button type="button" className="panel-item" role="menuitem">
            Settings
          </button>
        </Menu>
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'Account' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Sheet', () => {
  it('shows as a modal when open and reports close', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <Sheet open={false} onClose={onClose} title="Add to a book">
        <p>content</p>
      </Sheet>,
    );
    expect(screen.getByRole('dialog', { hidden: true })).not.toHaveAttribute('open');
    rerender(
      <Sheet open onClose={onClose} title="Add to a book">
        <p>content</p>
      </Sheet>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: 'Add to a book' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
