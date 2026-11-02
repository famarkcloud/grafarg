import { SelectableValue } from '@grafarg/data';
import { Icon, InlineField, InlineFieldRow, Input, Select } from '@grafarg/ui';
import { JsonDataSource } from '../datasource';
import { css } from 'emotion';
import React, { useEffect, useState } from 'react';
import { Pair } from '../types';

// ── Constants ──

const ATTRIBUTE_PATH = '/System_Attribute/RetrieveMultipleRecords';
const AGGREGATIONS = ['Get_Count', 'Get_Sum', 'Get_Avg', 'Get_StdDev', 'Get_Max', 'Get_Min'];
const AGGREGATION_OPTIONS = AGGREGATIONS.map((a) => ({ label: `${a}_`, value: a }));

const CONDITION_LABELS = [
  'Equal',
  'GreaterThan',
  'LessThan',
  'GreaterThanEqual',
  'LessThanEqual',
  'In',
  'Between',
  'IsNull',
  'On',
  'OnOrBefore',
  'OnOrAfter',
  'ChildOf',
  'Contains',
  'BeginsWith',
  'EndsWith',
  'IsTrue',
  'IsFalse',
];
const CONDITION_OPTIONS: Array<SelectableValue<number>> = CONDITION_LABELS.map((label, i) => ({ label, value: i }));

const TIMESERIES_OPERATOR = 17;
const TIMESERIES_FROM = '${__from:date:iso}';
const TIMESERIES_TO = '${__to:date:iso}';
const DATE_TIME_PARTS = ['Date', 'Time', 'Day', 'Month', 'Year'].map((v) => ({ label: v, value: v }));

// ── Helpers ──

/** Split "Get_Sum_Revenue" → ["Get_Sum", "Revenue"], or "Revenue" → ["", "Revenue"] */
export const splitColumnIntoAggAndAttribute = (column: string): [string, string] => {
  const agg = AGGREGATIONS.find((a) => column.startsWith(a + '_'));
  if (agg) {
    return [agg, column.slice(agg.length + 1)];
  }
  return AGGREGATIONS.includes(column) ? [column, ''] : ['', column];
};

/** Build a column string from aggregation + attribute */
const buildColumn = (agg: string, attr: string) => {
  if (agg && attr) {
    return `${agg}_${attr}`;
  }
  return agg || attr;
};

/** Check if a condition represents a timeseries filter */
const isTimeseries = (c: any) =>
  c.Operator === 6 && c.Values?.[0] === TIMESERIES_FROM && c.Values?.[1] === TIMESERIES_TO;

/** Parse body JSON string into structured parts */
const parseBody = (body: string) => {
  try {
    const obj = JSON.parse(body || '{}');
    const columns = String(obj.Columns ?? '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    return {
      columns,
      orderBy: String(obj.OrderBy ?? '').trim(),
      groupBy: String(obj.GroupBy ?? '').trim(),
      dateTimePart: String(obj.DateTimePart ?? ''),
      dateTimeInterval: String(obj.DateTimeInterval ?? ''),
      filter: obj.Filter,
    };
  } catch {
    return {
      columns: [] as string[],
      orderBy: '',
      groupBy: '',
      dateTimePart: '',
      dateTimeInterval: '',
      filter: undefined as any,
    };
  }
};

interface OrderByItem {
  field: string;
  desc: boolean;
}

const EMPTY_ORDER_ITEM: OrderByItem = { field: '', desc: false };
const EMPTY_CONDITION = { FieldName: '', Operator: 0, Values: [''] };

const parseOrderBy = (orderBy: string): OrderByItem[] => {
  const items = orderBy
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [field, direction] = part.split(/\s+/);
      return { field, desc: direction?.toLowerCase() === 'desc' };
    });
  return items.length ? items : [EMPTY_ORDER_ITEM];
};

const formatOrderBy = (items: OrderByItem[]): string =>
  items
    .filter((item) => item.field)
    .map((item) => (item.desc ? `${item.field} desc` : item.field))
    .join(', ');

/** Fetch entity attributes from the API */
export const fetchAttributeOptions = async (
  datasource: JsonDataSource,
  headers: Array<Pair<string, string>>,
  entityId: string
): Promise<Array<SelectableValue<string>>> => {
  const body = JSON.stringify({
    Columns: 'SystemName, AttributeType',
    Filter: {
      Operator: 0,
      Conditions: [{ FieldName: 'EntityId', Operator: 0, ServerValue: 0, Values: [entityId], IsNot: false }],
    },
    OrderBy: 'SystemName',
  });
  const records = await datasource.api.cachedGet(300, 'POST', ATTRIBUTE_PATH, [], headers, body, {
    hideFromInspector: true,
  });
  return records.map((r: any) => ({ label: r.SystemName, value: r.SystemName, attributeType: r.AttributeType }));
};

/** Get condition dropdown options, adding Timeseries when attribute is DateTime */
const getConditionOptions = (attrType?: string) => {
  const options = [...CONDITION_OPTIONS];
  if (attrType === 'TypeDateTime') {
    options.push({ label: 'Timeseries', value: TIMESERIES_OPERATOR });
  }
  return options;
};

// ── Value Inputs Component ──

interface ValueInputsProps {
  operator: number;
  values: string[];
  onChange: (v: string[]) => void;
}

const ValueInputs: React.FC<ValueInputsProps> = ({ operator, values, onChange }) => {
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);

  // Timeseries — read-only from/to
  if (operator === TIMESERIES_OPERATOR) {
    return (
      <>
        <Input width={20} value={TIMESERIES_FROM} disabled />
        <Input width={20} value={TIMESERIES_TO} disabled />
      </>
    );
  }

  // Between — two inputs
  if (operator === 6) {
    return (
      <>
        <Input
          width={20}
          placeholder="Value 1"
          value={values[0] || ''}
          onChange={(e) => onChange([e.currentTarget.value, values[1] || ''])}
        />
        <Input
          width={20}
          placeholder="Value 2"
          value={values[1] || ''}
          onChange={(e) => onChange([values[0] || '', e.currentTarget.value])}
        />
      </>
    );
  }

  // In — dynamic list of inputs
  if (operator === 5) {
    return (
      <>
        {values.map((val, i) => (
          <React.Fragment key={i}>
            <Input
              width={20}
              value={val}
              placeholder={`Value ${i + 1}`}
              onChange={(e) => {
                const updated = [...values];
                updated[i] = e.currentTarget.value;
                onChange(updated);
                setRemoveIndex(null);
              }}
              onDoubleClick={() => values.length > 1 && setRemoveIndex(removeIndex === i ? null : i)}
            />
            {removeIndex === i && (
              <div
                className="gf-form-label"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  onChange(values.filter((_, j) => j !== i));
                  setRemoveIndex(null);
                }}
              >
                Remove
              </div>
            )}
          </React.Fragment>
        ))}
        <div className="gf-form-label" style={{ cursor: 'pointer' }} onClick={() => onChange([...values, ''])}>
          <Icon name="ellipsis-v" style={{ transform: 'rotate(90deg)' }} />
        </div>
      </>
    );
  }

  // Default — single input
  return (
    <Input width={20} placeholder="Value" value={values[0] || ''} onChange={(e) => onChange([e.currentTarget.value])} />
  );
};

// ── Main Component ──

interface Props {
  datasource: JsonDataSource;
  entityId?: string;
  headers: Array<Pair<string, string>>;
  body: string;
  onBodyChange: (body: string, attributes?: Array<SelectableValue<string>>) => void;
  operation?: string;
}

export const BodyQueryBuilder: React.FC<Props> = ({ datasource, entityId, headers, body, onBodyChange, operation }) => {
  const isStats = operation === 'RetrieveStats';

  // State
  const [columns, setColumns] = useState<string[]>(['']);
  const [groupBy, setGroupBy] = useState('');
  const [orderList, setOrderList] = useState<OrderByItem[]>([EMPTY_ORDER_ITEM]);
  const [dateTimePart, setDateTimePart] = useState('');
  const [dateTimeInterval, setDateTimeInterval] = useState('');
  const [attributes, setAttributes] = useState<Array<SelectableValue<string>>>([]);
  const [loadingAttrs, setLoadingAttrs] = useState(false);
  const [pendingCondition, setPendingCondition] = useState<any>(EMPTY_CONDITION);

  // ── Sync state from body prop ──
  useEffect(() => {
    const parsed = parseBody(body);
    setColumns(parsed.columns.length ? parsed.columns : ['']);
    setGroupBy(parsed.groupBy);
    setOrderList(parseOrderBy(parsed.orderBy));
    setDateTimePart(parsed.dateTimePart);
    setDateTimeInterval(parsed.dateTimeInterval);
  }, [body, isStats]);

  // ── Fetch attributes when entity changes ──
  useEffect(() => {
    if (!entityId) {
      setAttributes([]);
      return;
    }
    setLoadingAttrs(true);
    fetchAttributeOptions(datasource, headers, entityId)
      .then(setAttributes)
      .catch(() => setAttributes([]))
      .finally(() => setLoadingAttrs(false));
  }, [datasource, entityId, headers]);

  // ── Current filter conditions from body ──
  const conditions: any[] = parseBody(body).filter?.Conditions ?? [];

  // ── Save Helpers ──

  /** Save columns, orderBy, and dateTime fields to body JSON */
  const saveColumns = (
    cols: string[],
    order: string,
    dtPart = dateTimePart,
    dtInterval = dateTimeInterval,
    conds = conditions
  ) => {
    let obj: any = {};
    try {
      obj = JSON.parse(body || '{}');
    } catch {}

    obj.Columns = cols.filter(Boolean).join(', ') || undefined;

    if (isStats) {
      const isDate = attrType(order) === 'TypeDateTime';
      obj.GroupBy = order || undefined;
      obj.DateTimePart = isDate && dtPart ? dtPart : undefined;
      obj.DateTimeInterval = isDate && dtPart === 'Time' && dtInterval ? dtInterval : undefined;
      delete obj.OrderBy;
    } else {
      obj.OrderBy = order || undefined;
      delete obj.GroupBy;
      delete obj.DateTimePart;
      delete obj.DateTimeInterval;
    }

    if (conds.length > 0) {
      obj.Filter = { Operator: 0, Conditions: conds };
    } else {
      delete obj.Filter;
    }

    // Remove undefined keys
    Object.keys(obj).forEach((k) => obj[k] === undefined && delete obj[k]);
    onBodyChange(JSON.stringify(obj, null, 2), attributes);
  };

  // ── Save filter conditions to body JSON — reads columns from body to avoid stale React state ──
  const saveFilter = (conds: any[]) => {
    const p = parseBody(body);
    saveColumns(
      p.columns.length ? p.columns : columns,
      isStats ? p.groupBy || groupBy : p.orderBy || formatOrderBy(orderList),
      p.dateTimePart || dateTimePart,
      p.dateTimeInterval || dateTimeInterval,
      conds
    );
  };

  // ── Column Actions ──

  const changeColumn = (index: number, value?: string) => {
    const updated = [...columns];
    if (!value && updated.length > 1) {
      updated.splice(index, 1);
    } else {
      updated[index] = value ?? '';
    }
    setColumns(updated);
    saveColumns(updated, isStats ? groupBy : formatOrderBy(orderList));
  };

  const addColumn = () => setColumns([...columns, '']);

  // ── OrderBy Actions ──
  const changeOrderField = (index: number, field?: string) => {
    const updated = [...orderList];
    if (!field && updated.length > 1) {
      updated.splice(index, 1);
    } else {
      updated[index] = { ...updated[index], field: field ?? '' };
    }
    setOrderList(updated);
    saveColumns(columns, formatOrderBy(updated));
  };

  const changeOrderDesc = (index: number, desc: boolean) => {
    const updated = [...orderList];
    updated[index] = { ...updated[index], desc };
    setOrderList(updated);
    saveColumns(columns, formatOrderBy(updated));
  };

  const addOrderItem = () => setOrderList([...orderList, EMPTY_ORDER_ITEM]);

  const changeGroupBy = (value?: string) => {
    const v = value ?? '';
    const isDate = attrType(v) === 'TypeDateTime';
    setGroupBy(v);
    if (!isDate) {
      setDateTimePart('');
      setDateTimeInterval('');
      saveColumns(columns, v, '', '');
    } else {
      saveColumns(columns, v);
    }
  };

  // ── Filter Actions ──

  const removeCondition = (index: number) => saveFilter(conditions.filter((_, i) => i !== index));

  // Update an existing condition and save immediately
  const updateCondition = (index: number, changes: any) => {
    const condition = { ...conditions[index], ...changes };
    if (!condition.FieldName) {
      return; // don't save a condition without an attribute
    }
    const updated = [...conditions];
    updated[index] = condition;
    saveFilter(updated);
  };

  // Route changes: blank row → stage in pendingCondition, existing row → save immediately
  const setCondition = (index: number, changes: any) => {
    const isNew = index === conditions.length;
    const current = isNew ? pendingCondition : conditions[index];
    // Reset operator and values if switching away from DateTime on a Timeseries condition
    if (changes.FieldName !== undefined && isTimeseries(current) && attrType(changes.FieldName) !== 'TypeDateTime') {
      changes = { ...changes, Operator: 0, Values: [''] };
    }
    if (isNew) {
      setPendingCondition({ ...pendingCondition, ...changes });
    } else {
      updateCondition(index, changes);
    }
  };

  // Save pending condition when user clicks +
  const addCondition = () => {
    if (!pendingCondition.FieldName) {
      return;
    }
    saveFilter([...conditions, pendingCondition]);
    setPendingCondition(EMPTY_CONDITION);
  };

  /** Get the default values when switching operator */
  const defaultValues = (op: number, current: string[]): string[] => {
    if (op === TIMESERIES_OPERATOR) {
      return [TIMESERIES_FROM, TIMESERIES_TO];
    }
    if (op === 6) {
      return ['', ''];
    }
    return [current[0] || ''];
  };

  /** Get attribute type by name */
  const attrType = (name: string) => attributes.find((a) => a.value === name)?.attributeType;

  // ── Styles ──
  const rowStyle = css`
    display: flex;
    gap: 4px;
    align-items: center;
    flex-wrap: wrap;
  `;
  const checkboxLabelStyle: React.CSSProperties = { cursor: 'pointer', width: 74 };
  return (
    <>
      {/* ── Columns ── */}
      <InlineFieldRow>
        <InlineField
          label="Columns"
          labelWidth={16}
          grow
          className={css`
            flex: 1 1 0;
            min-width: 0;
          `}
        >
          <div
            className={css`
              display: flex;
              flex-wrap: wrap;
              gap: 4px;
              align-items: center;
              width: 100%;
            `}
          >
            {columns.map((col, i) => {
              if (isStats) {
                const [agg, attr] = splitColumnIntoAggAndAttribute(col);
                return (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <span
                        className={css`
                          font-weight: bold;
                          padding: 0 4px;
                          opacity: 0.7;
                        `}
                      >
                        ,
                      </span>
                    )}
                    <div
                      className={css`
                        display: inline-flex;
                        gap: 4px;
                      `}
                    >
                      <Select
                        placeholder="Function"
                        value={agg ? { label: `${agg}_`, value: agg } : undefined}
                        options={AGGREGATION_OPTIONS}
                        isClearable
                        onChange={(v) => changeColumn(i, buildColumn(v?.value ?? '', attr))}
                        width={20}
                      />
                      <Select
                        placeholder="Attribute"
                        isLoading={loadingAttrs}
                        value={attr ? { label: attr, value: attr } : undefined}
                        options={attributes}
                        isClearable
                        onChange={(v) => changeColumn(i, buildColumn(agg, v?.value ?? ''))}
                        width={20}
                      />
                    </div>
                  </React.Fragment>
                );
              }
              return (
                <Select
                  key={i}
                  placeholder="Column"
                  isLoading={loadingAttrs}
                  isClearable
                  value={col ? { label: col, value: col } : undefined}
                  options={attributes}
                  onChange={(v) => changeColumn(i, v?.value)}
                  width={20}
                />
              );
            })}
            <div className="gf-form-label" style={{ cursor: 'pointer' }} onClick={addColumn}>
              <Icon name="plus" />
            </div>
          </div>
        </InlineField>
      </InlineFieldRow>

      {/* ── OrderBy / GroupBy + DateTime ── */}
      {isStats ? (
        <>
          <InlineFieldRow>
            <InlineField label="GroupBy" labelWidth={16} grow>
              <Select
                placeholder="GroupBy"
                isLoading={loadingAttrs}
                isClearable
                value={groupBy ? { label: groupBy, value: groupBy } : undefined}
                options={attributes}
                onChange={(v) => changeGroupBy(v?.value)}
                width={20}
              />
            </InlineField>
          </InlineFieldRow>
          {attrType(groupBy) === 'TypeDateTime' && (
            <>
              <InlineFieldRow>
                <InlineField label="DateTimePart" labelWidth={16}>
                  <Select
                    placeholder="DateTimePart"
                    isClearable
                    value={dateTimePart ? { label: dateTimePart, value: dateTimePart } : undefined}
                    options={DATE_TIME_PARTS}
                    onChange={(v) => {
                      const part = v?.value ?? '';
                      setDateTimePart(part);
                      if (part !== 'Time') {
                        setDateTimeInterval('');
                      }
                      saveColumns(columns, groupBy, part, part === 'Time' ? dateTimeInterval : '');
                    }}
                    width={20}
                  />
                </InlineField>
              </InlineFieldRow>
              {dateTimePart === 'Time' && (
                <InlineFieldRow>
                  <InlineField label="DateTimeInterval" labelWidth={16}>
                    <Input
                      placeholder="e.g. 1h, 1m"
                      value={dateTimeInterval}
                      onChange={(e) => setDateTimeInterval(e.currentTarget.value)}
                      onBlur={(e) => saveColumns(columns, groupBy, dateTimePart, e.currentTarget.value)}
                      width={20}
                    />
                  </InlineField>
                </InlineFieldRow>
              )}
            </>
          )}
        </>
      ) : (
        <InlineFieldRow>
          <InlineField
            label="OrderBy"
            labelWidth={16}
            grow
            className={css`
              flex: 1 1 0;
              min-width: 0;
            `}
          >
            <div
              className={css`
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                align-items: center;
                width: 100%;
              `}
            >
              {orderList.map((item, index) => (
                <div
                  key={index}
                  className={css`
                    display: inline-flex;
                    gap: 4px;
                    align-items: center;
                  `}
                >
                  <Select
                    placeholder="OrderBy"
                    isLoading={loadingAttrs}
                    isClearable
                    value={item.field ? { label: item.field, value: item.field } : undefined}
                    options={attributes}
                    onChange={(v) => changeOrderField(index, v?.value)}
                    width={20}
                  />
                  <label className="gf-form-label" style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={item.desc}
                      onChange={(e) => changeOrderDesc(index, e.currentTarget.checked)}
                    />
                    Desc
                  </label>
                </div>
              ))}
              <a className="gf-form-label" onClick={addOrderItem}>
                <Icon name="plus" />
              </a>
            </div>
          </InlineField>
        </InlineFieldRow>
      )}

      {/* ── Filter Section ── */}
      <InlineFieldRow>
        <InlineField
          label="Filter"
          labelWidth={16}
          grow
          className={css`
            flex: 1 1 0;
            min-width: 0;
          `}
        >
          <div
            className={css`
              display: flex;
              flex-direction: column;
              gap: 4px;
              width: 100%;
            `}
          >
            {[...conditions, pendingCondition].map((c: any, i: number) => {
              const isNew = i === conditions.length;
              const isTs = isTimeseries(c);
              const displayOp = isTs ? TIMESERIES_OPERATOR : c.Operator;
              const opts = getConditionOptions(isTs ? 'TypeDateTime' : attrType(c.FieldName));
              const vals: string[] = c.Values || [''];

              return (
                <div key={i} className={rowStyle}>
                  <Select
                    width={20}
                    placeholder="Attribute"
                    options={attributes}
                    value={c.FieldName ? { label: c.FieldName, value: c.FieldName } : null}
                    onChange={(v) => setCondition(i, { FieldName: v?.value || '' })}
                    isLoading={loadingAttrs}
                  />
                  <Select
                    width={20}
                    options={opts}
                    value={opts.find((o) => o.value === displayOp)}
                    onChange={(v) => {
                      const op = v.value!;
                      setCondition(i, {
                        Operator: op === TIMESERIES_OPERATOR ? 6 : op,
                        Values: defaultValues(op, vals),
                      });
                    }}
                  />
                  <label className="gf-form-label" style={checkboxLabelStyle}>
                    <input
                      type="checkbox"
                      checked={!!c.IsNot}
                      onChange={(e) => setCondition(i, { IsNot: e.target.checked })}
                    />
                    Is Not
                  </label>
                  <ValueInputs operator={displayOp} values={vals} onChange={(v) => setCondition(i, { Values: v })} />
                  {isNew ? (
                    <div className="gf-form-label" style={{ cursor: 'pointer' }} onClick={addCondition}>
                      <Icon name="plus" />
                    </div>
                  ) : (
                    <div className="gf-form-label" style={{ cursor: 'pointer' }} onClick={() => removeCondition(i)}>
                      <Icon name="trash-alt" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </InlineField>
      </InlineFieldRow>
    </>
  );
};
