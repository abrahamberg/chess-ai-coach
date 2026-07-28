import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ToolActivity } from './ToolActivity.js';

describe('ToolActivity', () => {
  test('shows a subtle activity line for get_engine_analysis', () => {
    render(<ToolActivity toolName="get_engine_analysis" />);
    expect(screen.getByText(/checking a line/i)).toBeInTheDocument();
  });

  test.each(['update_threads', 'get_user_profile', 'record_finding', 'propose_focus_area_update'])(
    'renders nothing for the backstage tool %s',
    (toolName) => {
      const { container } = render(<ToolActivity toolName={toolName} />);
      expect(container).toBeEmptyDOMElement();
    }
  );

  test('renders nothing when there is no active tool call', () => {
    const { container } = render(<ToolActivity toolName={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
