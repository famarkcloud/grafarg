import { DataSourcePluginOptionsEditorProps } from '@grafarg/data';
import { DataSourceHttpSettings, InlineField, Input, RadioButtonGroup } from '@grafarg/ui';
import React, { ChangeEvent, useEffect, useRef, useState } from 'react';
import { JsonApiDataSourceOptions } from '../types';
import { setSessionPassword, setSessionListener } from '../datasource';

type Props = DataSourcePluginOptionsEditorProps<JsonApiDataSourceOptions>;

/** Auth mode options shown in the radio toggle */
const AUTH_MODE_OPTIONS = [
  { label: 'OAuth Forwarding', value: 'oauth' },
  { label: 'User / Password', value: 'userpass' },
];

const DEFAULT_BASE_URL = 'https://www.famark.com/Host/api.svc/';

// Extract domain from URL (segment after api.svc or last path segment)
const extractDomainFromUrl = (url?: string): string => {
  const clean = (url || '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  const last = clean.split('/').pop() || '';
  return last.toLowerCase().endsWith('.svc') || clean.split('/').length <= 3 ? '' : last;
};

// Update or append domain at the end of the URL
const updateUrlWithDomain = (currentUrl: string | undefined, newDomain: string): string => {
  const base = (currentUrl?.trim() || DEFAULT_BASE_URL).replace(/[?#].*$/, '').replace(/\/+$/, '');
  const cleanBase = extractDomainFromUrl(base) ? base.slice(0, base.lastIndexOf('/')) : base;
  const domain = newDomain.trim().replace(/^\/+|\/+$/g, '');
  return domain ? `${cleanBase}/${domain}` : `${cleanBase}/`;
};

const getAuthMode = (jd?: any): 'oauth' | 'userpass' => {
  if (jd?.authMode === 'userpass' || jd?.authMode === 'oauth') {
    return jd.authMode;
  }
  if (jd?.httpHeaderName1 || jd?.credUsername) {
    return 'userpass';
  }
  return 'oauth';
};

/** ConfigEditor lets the user configure connection details like the URL or authentication. */
export const ConfigEditor: React.FC<Props> = ({ options, onOptionsChange }) => {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Auth mode (derived directly from options.jsonData)
  const authMode = getAuthMode(options.jsonData);

  // Domain Name (synced with URL ending)
  const domainName = options.jsonData.domainName ?? extractDomainFromUrl(options.url);

  // User / Password credentials state
  const credUsername = (options.jsonData as any).credUsername ?? '';
  const [credPassword, setCredPassword] = useState('');

  // Listen for SessionId updates saved via testDatasource ("Save & Test")
  useEffect(() => {
    setSessionListener((payload?: any) => {
      setCredPassword('');
      if (payload && typeof payload === 'object' && payload.version) {
        onOptionsChange(payload);
      } else {
        const newVersion = typeof payload === 'number' ? payload : optionsRef.current.version;
        onOptionsChange({
          ...optionsRef.current,
          version: newVersion,
          jsonData: {
            ...optionsRef.current.jsonData,
            httpHeaderName1: 'SessionId',
          },
          secureJsonFields: {
            ...optionsRef.current.secureJsonFields,
            httpHeaderValue1: true,
          },
        });
      }
    });
    return () => setSessionListener(null);
  }, [onOptionsChange]);

  // On mount: default oauthPassThru to true when authMode is 'oauth' and sync domainName if present in URL
  useEffect(() => {
    const currentAuthMode = getAuthMode(options.jsonData);
    const currentOAuthPassThru = (options.jsonData as any).oauthPassThru;
    const needsOAuthDefault = currentAuthMode === 'oauth' && currentOAuthPassThru === undefined;

    const detectedDomain = extractDomainFromUrl(options.url);
    const needsDomainSync = !options.jsonData.domainName && detectedDomain;

    if (needsOAuthDefault || needsDomainSync) {
      onOptionsChange({
        ...options,
        jsonData: {
          ...options.jsonData,
          ...(needsOAuthDefault ? { oauthPassThru: true } : {}),
          ...(needsDomainSync ? { domainName: detectedDomain } : {}),
        },
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When Domain Name input changes: update domainName in jsonData and update ending of URL
  const onDomainChange = (newDomain: string) => {
    const newUrl = updateUrlWithDomain(options.url, newDomain);
    onOptionsChange({
      ...options,
      url: newUrl,
      jsonData: {
        ...options.jsonData,
        domainName: newDomain,
      },
    });
  };

  const onParamsChange = (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: { ...options.jsonData, queryParams: e.currentTarget.value },
    });
  };

  // Auth mode change: updates local form state ONLY.
  // Preserves username & password credentials so switching back doesn't lose user input.
  // No silentPut or DB writes: changes persist only when user clicks "Save & Test".
  const onAuthModeChange = (mode: 'oauth' | 'userpass') => {
    const isOAuth = mode === 'oauth';
    const { httpHeaderName1, ...restJson } = options.jsonData as any;
    onOptionsChange({
      ...options,
      jsonData: { ...(isOAuth ? restJson : options.jsonData), authMode: mode, oauthPassThru: isOAuth },
      secureJsonFields: { ...options.secureJsonFields, ...(isOAuth ? { httpHeaderValue1: false } : {}) },
      ...(isOAuth ? { secureJsonData: { ...(options.secureJsonData ?? {}), httpHeaderValue1: '' } } : {}),
    });
  };

  const httpHeaderKey = `${(options.jsonData as any).httpHeaderName1 ?? 'none'}-${
    (options.jsonData as any).oauthPassThru ?? false
  }-${options.version ?? 0}`;

  return (
    <>
      {/* Famark Auth Section (at the top, above HTTP) */}
      <h3 className="page-heading">Famark Auth</h3>
      <div className="gf-form-group">
        <div className="gf-form">
          <InlineField
            label="Auth Mode"
            labelWidth={20}
            tooltip="OAuth Forwarding: passes the signed-in user token. User/Password: fetches a SessionId from Famark."
          >
            <RadioButtonGroup
              options={AUTH_MODE_OPTIONS}
              value={authMode}
              onChange={(v) => onAuthModeChange(v as 'oauth' | 'userpass')}
            />
          </InlineField>
        </div>

        {/* Domain Name — shown for both oauth and userpass modes */}
        <div className="gf-form">
          <InlineField label="Domain Name" labelWidth={20} tooltip="Your Famark domain, e.g. 'starter'">
            <Input
              width={40}
              value={domainName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onDomainChange(e.currentTarget.value)}
              placeholder="Domain Name"
            />
          </InlineField>
        </div>

        {/* User / Password — additional fields only for userpass mode */}
        {authMode === 'userpass' && (
          <>
            <div className="gf-form">
              <InlineField label="Username" labelWidth={20}>
                <Input
                  width={40}
                  value={credUsername}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const val = e.currentTarget.value;
                    onOptionsChange({
                      ...options,
                      jsonData: { ...options.jsonData, credUsername: val } as any,
                    });
                  }}
                  placeholder="Username"
                  autoComplete="username"
                />
              </InlineField>
            </div>

            <div className="gf-form">
              <InlineField
                label="Password"
                labelWidth={20}
                tooltip={
                  options.secureJsonFields?.password || options.secureJsonFields?.httpHeaderValue1
                    ? 'Password saved. Enter a new one to change.'
                    : 'Password used to fetch a SessionId from Famark. Stored encrypted.'
                }
              >
                <Input
                  width={40}
                  type="password"
                  value={credPassword}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    setCredPassword(e.currentTarget.value);
                    setSessionPassword(e.currentTarget.value);
                  }}
                  placeholder="Password"
                  autoComplete="current-password"
                />
              </InlineField>
            </div>
          </>
        )}
      </div>

      {/* Standard Grafarg HTTP Settings: handles URL, Access, Whitelisted Cookies, Auth, and Custom HTTP Headers */}
      <DataSourceHttpSettings
        key={httpHeaderKey}
        defaultUrl={DEFAULT_BASE_URL}
        dataSourceConfig={options}
        onChange={(newOpts) => {
          const jd = newOpts.jsonData as JsonApiDataSourceOptions;
          const sessionHeaderDeleted = !!(options.jsonData as any).httpHeaderName1 && !(jd as any).httpHeaderName1;
          const updatedSecureJsonFields = sessionHeaderDeleted
            ? { ...newOpts.secureJsonFields, httpHeaderValue1: false }
            : newOpts.secureJsonFields;

          // When user edits URL in DataSourceHttpSettings, auto-extract the domain name from the URL ending
          const urlDomain = extractDomainFromUrl(newOpts.url);

          onOptionsChange({
            ...newOpts,
            jsonData: {
              ...jd,
              domainName: urlDomain !== undefined ? urlDomain : jd.domainName,
              oauthPassThru: jd.oauthPassThru,
            },
            secureJsonFields: updatedSecureJsonFields,
            ...(sessionHeaderDeleted
              ? {
                  secureJsonData: {
                    ...(newOpts.secureJsonData ?? {}),
                    httpHeaderValue1: '',
                  },
                }
              : {}),
          });
        }}
      />

      <h3 className="page-heading">Misc</h3>
      <div className="gf-form">
        <InlineField label="Query string" labelWidth={20} tooltip="Add a custom query string to your queries.">
          <Input
            width={40}
            value={options.jsonData.queryParams}
            onChange={onParamsChange}
            spellCheck={false}
            placeholder="page=1&limit=100"
          />
        </InlineField>
      </div>
    </>
  );
};
