import { Children, Fragment, isValidElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import { SearchSelect, type Option } from './SearchSelect';
import { cx } from './ui';

// A drop-in for <select>: the same props and <option> children. A list longer than a few choices (rigs, units,
// people, wires, items, lookups ...) becomes the searchable dropdown; a short fixed list (Yes / No, a status) stays
// a native select. onChange gets { target: { value } } either way, so existing handlers keep working.

const SEARCH_FROM = 5;

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
  value?: string | number | null; onChange?: (e: { target: { value: string } }) => void; children?: ReactNode; searchPlaceholder?: string;
  /** Always searchable (a list read from a table, however short it is today) or never (a fixed choice). */
  search?: boolean;
};

const textOf = (n: ReactNode): string => {
  if (n === null || n === undefined || typeof n === 'boolean') return '';
  if (typeof n === 'string' || typeof n === 'number') return String(n);
  if (Array.isArray(n)) return n.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(n)) return textOf(n.props.children);
  return '';
};

/** The <option>s under the children, through arrays and fragments. */
function optionsOf(children: ReactNode): Option[] {
  const out: Option[] = [];
  const walk = (n: ReactNode) => {
    Children.forEach(n, (c) => {
      if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(c)) return;
      if (c.type === Fragment) { walk(c.props.children); return; }
      if (c.type === 'option') {
        const label = textOf(c.props.children);
        out.push({ value: String(c.props.value ?? label), label, disabled: c.props.disabled });
      }
    });
  };
  walk(children);
  return out;
}

export function Select({ value, onChange, children, className, id, disabled, searchPlaceholder, search, ...rest }: Props) {
  const options = optionsOf(children);
  if (search === false || (search === undefined && options.length < SEARCH_FROM)) {
    return <select id={id} disabled={disabled} className={className} value={value ?? ''} onChange={(e) => onChange?.(e)} {...rest}>{children}</select>;
  }
  const empty = options.find((o) => o.value === '');
  // the native select's classes carry its width; the searchable one keeps them on its wrapper
  const width = (className ?? '').split(/\s+/).filter((c) => /^(w-|min-w-|max-w-|flex-|sm:|md:|lg:)/.test(c)).join(' ');
  return (
    <SearchSelect id={id} className={cx(width || 'w-full')} value={String(value ?? '')} disabled={disabled}
      options={options.filter((o) => o.value !== '')} allowEmpty={!!empty} placeholder={empty?.label ?? '— Select —'} emptyLabel={empty?.label}
      ariaLabel={rest['aria-label']} ariaDescribedBy={rest['aria-describedby']} invalid={rest['aria-invalid'] === true || rest['aria-invalid'] === 'true'}
      searchPlaceholder={searchPlaceholder ?? (rest['aria-label'] ? `Search ${String(rest['aria-label']).toLowerCase()}…` : 'Search…')}
      onChange={(v) => onChange?.({ target: { value: v } })} />
  );
}
