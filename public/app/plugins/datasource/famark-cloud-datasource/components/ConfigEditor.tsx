import { AppEvents, DataSourcePluginOptionsEditorProps } from '@grafarg/data';
import { getBackendSrv } from '@grafarg/runtime';
import Api from '../api';
import {
  FieldValidationMessage,
  Button,
  DataSourceHttpSettings,
  InlineField,
  InlineFieldRow,
  InlineFormLabel,
  Input,
  RadioButtonGroup,
  TagsInput,
} from '@grafarg/ui';
import React, { ChangeEvent, useEffect, useState } from 'react';
import { JsonApiDataSourceOptions } from '../types';
import appEvents from 'app/core/app_events';

type Props = DataSourcePluginOptionsEditorProps<JsonApiDataSourceOptions>;

// Auth mode options shown in the radio toggle
const AUTH_MODE_OPTIONS = [
  { label: 'OAuth Forwarding', value: 'oauth' },
  { label: 'User / Password', value: 'userpass' },
];

const DEFAULT_BASE_URL = 'https://www.famark.com/Host/api.svc/';

/** ConfigEditor lets the user configure connection details like the URL or authentication. */
export const ConfigEditor: React.FC<Props> = ({ options, onOptionsChange }) => {
  const baseUrl = options.jsonData.baseUrl ?? DEFAULT_BASE_URL;
  const domainName = options.jsonData.domainName ?? '';
  const combinedUrl = (base: string, domain: string) => {
    const cleanBase = base.endsWith('/') ? base : base + '/';
    return domain ? cleanBase + domain : cleanBase;
  };

  const [authMode, setAuthMode] = useState<'oauth' | 'userpass'>(
    ((options.jsonData as any).authMode ?? 'oauth') as 'oauth' | 'userpass'
  );
  const [credUsername, setCredUsername] = useState<string>(((options.jsonData as any).credUsername ?? '') as string);
  const [credPassword, setCredPassword] = useState('');
  const [credStatus, setCredStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [credError, setCredError] = useState('');
  const [setCount, setSetCount] = useState(0);

  useEffect(() => {
    const savedMode = ((options.jsonData as any).authMode ?? 'oauth') as string;
    const expected = savedMode === 'oauth';
    const currentCombined = options.url || combinedUrl(baseUrl, domainName);
    if (options.jsonData.oauthPassThru !== expected || !options.url || !options.jsonData.baseUrl) {
      onOptionsChange({
        ...options,
        url: currentCombined,
        jsonData: {
          ...options.jsonData,
          baseUrl: options.jsonData.baseUrl ?? baseUrl,
          domainName: options.jsonData.domainName ?? domainName,
          oauthPassThru: expected,
        },
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onBaseUrlChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newBase = e.currentTarget.value;
    onOptionsChange({
      ...options,
      url: combinedUrl(newBase, domainName),
      jsonData: { ...options.jsonData, baseUrl: newBase, oauthPassThru: authMode === 'oauth' },
    });
  };

  const onDomainNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newDomain = e.currentTarget.value;
    onOptionsChange({
      ...options,
      url: combinedUrl(baseUrl, newDomain),
      jsonData: { ...options.jsonData, domainName: newDomain, oauthPassThru: authMode === 'oauth' },
    });
  };

  const onParamsChange = (e: ChangeEvent<HTMLInputElement>) => {
    onOptionsChange({
      ...options,
      jsonData: { ...options.jsonData, queryParams: e.currentTarget.value },
    });
  };

  const onAuthModeChange = (mode: 'oauth' | 'userpass') => {
    setAuthMode(mode);
    setCredStatus('idle');
    setCredError('');
    onOptionsChange({
      ...options,
      jsonData: { ...options.jsonData, oauthPassThru: mode === 'oauth', authMode: mode } as any,
    });
  };

  const onConnectWithUserPass = async () => {
    const missing = [!domainName && 'Domain Name', !credUsername && 'Username', !credPassword && 'Password'].filter(
      Boolean
    );
    if (missing.length) {
      setCredError(`${missing.join(missing.length === 2 ? ' and ' : ', ')} required`);
      setCredStatus('error');
      return;
    }
    setCredStatus('loading');
    setCredError('');
    try {
      // Always fetch the latest datasource from server to get current version.
      // This prevents 409 "already updated" conflicts when user edits fields
      // (domain, URL, username, etc.) between Set clicks.
      let latestVersion = options.version;
      if (options.id) {
        const current = await getBackendSrv().get(`/api/datasources/${options.id}`);
        latestVersion = current.version;
      }

      // Step 1: save current URL to DB so proxy knows where to forward
      const opts: any = {
        ...options,
        version: latestVersion,
        url: combinedUrl(baseUrl, domainName),
        jsonData: {
          ...options.jsonData,
          baseUrl,
          domainName,
          oauthPassThru: false,
          authMode: 'userpass',
          credUsername,
        },
      };
      if (options.id) {
        const saved = await getBackendSrv().put(`/api/datasources/${options.id}`, opts);
        opts.version = saved?.datasource?.version ?? opts.version;
      }

      // Step 2: call /Credential/Connect through the proxy (URL is now in the DB)
      const body = JSON.stringify({ DomainName: domainName, UserName: credUsername, Password: credPassword });
      const sessionId: string = await new Api('/api/datasources/proxy/' + options.id, '').get(
        'POST',
        '/Credential/Connect',
        [],
        [['Content-Type', 'application/json']],
        body,
        { hideFromInspector: true }
      );

      // Step 3: save the SessionId header - use updated version so no 409
      const final: any = {
        ...opts,
        jsonData: { ...opts.jsonData, httpHeaderName1: 'SessionId' } as any,
        secureJsonData: { httpHeaderValue1: sessionId } as any,
        secureJsonFields: { ...opts.secureJsonFields, httpHeaderValue1: true },
      };
      if (options.id) {
        const saved2 = await getBackendSrv().put(`/api/datasources/${options.id}`, final);
        final.version = saved2?.datasource?.version ?? final.version;
      }
      onOptionsChange(final);
      setCredStatus('idle');
      setSetCount((c) => c + 1);
      appEvents.emit(AppEvents.alertSuccess, ['SessionId set successfully']);
    } catch (err) {
      // Even on error, sync the version from server so next attempt won't 409
      if (options.id) {
        try {
          const current = await getBackendSrv().get(`/api/datasources/${options.id}`);
          onOptionsChange({ ...options, version: current.version });
        } catch (_) {
          // ignore version sync failure
        }
      }
      setCredError((err as any)?.data?.ErrorMessage ?? (err as any)?.message ?? 'Connection failed');
      setCredStatus('error');
    }
  };

  const combined = combinedUrl(baseUrl, domainName);
  const httpHeaderKey = `${(options.jsonData as any).httpHeaderName1 ?? 'none'}-${setCount}`;

  return (
    <>
      <h3 className="page-heading">HTTP</h3>
      <div className="gf-form-group">
        <div className="gf-form">
          <InlineFieldRow>
            <InlineField label="URL" labelWidth={16} tooltip="Base API URL, e.g. https://www.famark.com/Host/api.svc/">
              <Input
                width={40}
                value={baseUrl}
                onChange={onBaseUrlChange}
                placeholder="https://www.famark.com/Host/api.svc/"
              />
            </InlineField>
          </InlineFieldRow>
        </div>
        <div className="gf-form">
          <InlineFieldRow>
            <InlineField
              label="Domain Name"
              labelWidth={16}
              tooltip="Tenant/domain name appended to the base URL, e.g. MyDomain"
            >
              <Input width={40} value={domainName} onChange={onDomainNameChange} placeholder="MyDomain" />
            </InlineField>
          </InlineFieldRow>
        </div>
        <div className="gf-form">
          <InlineFieldRow>
            <InlineField
              label="Combined URL"
              labelWidth={16}
              tooltip="The full URL sent to the API (Base URL + Domain)"
            >
              <Input width={40} value={combined} readOnly />
            </InlineField>
          </InlineFieldRow>
        </div>
        {options.access !== 'direct' && (
          <div className="gf-form">
            <InlineFormLabel
              width={16}
              tooltip="Grafarg Proxy deletes forwarded cookies by default. Specify cookies by name that should be forwarded to the data source."
            >
              Whitelisted Cookies
            </InlineFormLabel>
            <TagsInput
              tags={options.jsonData.keepCookies}
              onChange={(cookies) =>
                onOptionsChange({ ...options, jsonData: { ...options.jsonData, keepCookies: cookies } })
              }
            />
          </div>
        )}

        {/* Auth mode toggle: OAuth Forwarding (default) or User/Password */}
        <div className="gf-form">
          <InlineFormLabel
            width={16}
            tooltip="OAuth Forwarding passes the signed-in user token. User/Password fetches a SessionId from Famark and sets it as a Custom HTTP Header."
          >
            Auth Mode
          </InlineFormLabel>
          <RadioButtonGroup
            options={AUTH_MODE_OPTIONS}
            value={authMode}
            onChange={(v) => onAuthModeChange(v as 'oauth' | 'userpass')}
          />
        </div>

        {/* Username + Password inputs visible only when authMode is userpass */}
        {authMode === 'userpass' && (
          <>
            <div className="gf-form">
              <InlineField label="Username" labelWidth={16}>
                <Input
                  width={40}
                  value={credUsername}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const val = e.currentTarget.value;
                    setCredUsername(val);
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
              <InlineField label="Password" labelWidth={16}>
                <Input
                  width={40}
                  type="password"
                  value={credPassword}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setCredPassword(e.currentTarget.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                />
              </InlineField>
            </div>
            <div className="gf-form">
              <Button variant="primary" size="sm" onClick={onConnectWithUserPass} disabled={credStatus === 'loading'}>
                {credStatus === 'loading' ? 'Connecting...' : 'Set'}
              </Button>
            </div>
            {credStatus === 'error' && <FieldValidationMessage>{credError}</FieldValidationMessage>}
          </>
        )}
      </div>

      <DataSourceHttpSettings
        key={httpHeaderKey}
        defaultUrl={DEFAULT_BASE_URL}
        hideHttpSection={true}
        dataSourceConfig={{
          ...options,
          url: combined,
          jsonData: { ...options.jsonData, oauthPassThru: authMode === 'oauth' },
        }}
        onChange={(newOpts) => {
          const jd = newOpts.jsonData as JsonApiDataSourceOptions;
          onOptionsChange({
            ...newOpts,
            url: combinedUrl(jd.baseUrl ?? baseUrl, jd.domainName ?? domainName),
            jsonData: {
              ...jd,
              baseUrl: jd.baseUrl ?? baseUrl,
              domainName: jd.domainName ?? domainName,
              oauthPassThru: authMode === 'oauth',
            },
          });
        }}
      />

      <h3 className="page-heading">Misc</h3>
      <InlineFieldRow>
        <InlineField label="Query string" tooltip="Add a custom query string to your queries.">
          <Input
            width={50}
            value={options.jsonData.queryParams}
            onChange={onParamsChange}
            spellCheck={false}
            placeholder="page=1&limit=100"
          />
        </InlineField>
      </InlineFieldRow>
    </>
  );
};
