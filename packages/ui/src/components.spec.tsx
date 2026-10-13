import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import {
  Accordion,
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  ProgressBar,
  Radio,
  SegmentedControl,
  Sidebar,
  Tabs,
} from './index';

/** DoD 5: axe-core без нарушений serious/critical. color-contrast в jsdom не вычисляется. */
async function expectNoSeriousA11yViolations(container: Element) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

describe('packages/ui (раздел 3.2)', () => {
  it('REQ-GEN-DS-01 Button is keyboard-activatable and exposes its variant', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="publish" onClick={onClick}>
        Опубликовать
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Опубликовать' });
    expect(button).toHaveAttribute('data-variant', 'publish');
    expect(button).toHaveAttribute('type', 'button');
    await userEvent.tab();
    expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('REQ-GEN-DS-01 Tabs switch with arrow keys', async () => {
    render(
      <Tabs
        label="Урок"
        items={[
          { value: 'overview', label: 'Обзор', content: 'A' },
          { value: 'quiz', label: 'Квиз', content: 'B' },
        ]}
      />,
    );
    await userEvent.tab();
    expect(screen.getByRole('tab', { name: 'Обзор' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Квиз' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('B');
  });

  it('REQ-GEN-PREF-05 SegmentedControl keeps exactly one value and supports keyboard', async () => {
    function Harness() {
      const [value, setValue] = useState('ru');
      return (
        <>
          <SegmentedControl
            label="Язык"
            value={value}
            onValueChange={setValue}
            options={[
              { value: 'ru', label: 'RU' },
              { value: 'kk', label: 'KK' },
              { value: 'en', label: 'EN' },
            ]}
          />
          <output>{value}</output>
        </>
      );
    }
    render(<Harness />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('kk');
    await userEvent.keyboard('{Enter}'); // повторное нажатие не снимает выбор
    expect(screen.getByRole('status')).toHaveTextContent('kk');
  });

  it('REQ-NFR-A11Y-01 Field links label, hint and error to the control', async () => {
    const { container } = render(
      <Field label="Email" hint="Подсказка" error="Введите email, например name@example.com" required>
        <Input type="email" />
      </Field>,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(/Введите email.*Подсказка/);
    await expectNoSeriousA11yViolations(container);
  });

  it('REQ-NFR-A11Y-01 Modal closes on Escape and returns focus to the trigger', async () => {
    render(
      <Modal title="Как считается" closeLabel="Закрыть" trigger={<Button>Открыть</Button>}>
        Текст
      </Modal>,
    );
    const trigger = screen.getByRole('button', { name: 'Открыть' });
    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Как считается' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('PH-36 Accordion starts collapsed and allows several open items', async () => {
    render(
      <Accordion
        items={[
          { value: '1', title: '01', content: 'один' },
          { value: '2', title: '02', content: 'два' },
        ]}
      />,
    );
    const [first, second] = screen.getAllByRole('button');
    expect(first).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(first!);
    await userEvent.click(second!);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(second).toHaveAttribute('aria-expanded', 'true');
  });

  it('REQ-NFR-A11Y-01 Radio, Checkbox, ProgressBar and Sidebar have no serious axe violations', async () => {
    const { container } = render(
      <div>
        <Radio
          label="Варианты"
          onValueChange={() => {}}
          options={[
            { value: 'a', label: 'Аорта' },
            { value: 'b', label: 'Полая вена' },
          ]}
        />
        <Checkbox label="Показывать предмет в общем каталоге" checked={false} onCheckedChange={() => {}} />
        <ProgressBar value={40} label="Прогресс" />
        <Sidebar label="Разделы" items={[{ href: '/a', label: 'Курсы', icon: '•', active: true }]} />
      </div>,
    );
    await userEvent.tab();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('radio', { name: 'Аорта' })).toBeChecked();
    expect(screen.getByRole('link', { name: 'Курсы' })).toHaveAttribute('aria-current', 'page');
    await expectNoSeriousA11yViolations(container);
  });
});
