import React, { useEffect, useState } from 'react';

const isDev = (import.meta as any).env?.DEV;

interface IdentityUser {
    email: string;
    user_metadata?: { full_name?: string; avatar_url?: string };
    identities?: Array<{ provider: string; identity_data?: Record<string, string> }>;
    jwt: () => Promise<string>;
}

/**
 * Extract the profile photo URL from wherever GoTrue stored it.
 * GoTrue/Netlify Identity places it in different fields depending on
 * whether the account was created via OAuth or email, and which version
 * of the GoTrue daemon is running:
 *   1. user_metadata.avatar_url  — standard Google OAuth signup path
 *   2. identities[].identity_data.avatar_url — raw OAuth provider data
 *   3. identities[].identity_data.picture    — alternate Google field name
 */
function resolveAvatarUrl(user: any): string | undefined {
    const meta = user?.user_metadata;
    if (meta?.avatar_url) return meta.avatar_url;
    const identities: any[] = user?.identities ?? [];
    for (const id of identities) {
        const d = id?.identity_data;
        if (d?.avatar_url) return d.avatar_url;
        if (d?.picture) return d.picture;
    }
    return undefined;
}

/** Normalize raw GoTrue user, ensuring avatar_url is always in user_metadata. */
function normalizeUser(raw: any): IdentityUser | null {
    if (!raw) return null;
    const avatar_url = resolveAvatarUrl(raw);
    console.debug('[AuthGate] user fields:', {
        email: raw.email,
        'user_metadata.avatar_url': raw?.user_metadata?.avatar_url,
        'identities': raw?.identities?.map((i: any) => ({ provider: i.provider, data: i.identity_data })),
        resolved_avatar: avatar_url,
    });
    return {
        ...raw,
        user_metadata: { ...raw.user_metadata, avatar_url },
    };
}

interface IdentityWidget {
    init: (opts?: any) => void;
    open: (tab?: string) => void;
    close: () => void;
    currentUser: () => IdentityUser | null;
    logout: () => void;
    on: (event: string, callback: (user?: IdentityUser) => void) => void;
}

let _widget: IdentityWidget | null = null;
let _initPromise: Promise<IdentityWidget> | null = null;

/** Lazily load and init the widget (singleton). */
export async function ensureWidget(): Promise<IdentityWidget> {
    if (_widget) return _widget;
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        const mod = await import('netlify-identity-widget');
        _widget = mod.default as unknown as IdentityWidget;
        _widget.init();
        return _widget;
    })();
    return _initPromise;
}

/** Get current user (may be null). */
export function getCurrentUser(): IdentityUser | null {
    return _widget?.currentUser?.() ?? null;
}

/** Trigger logout. */
export function logout(): void {
    _widget?.logout();
}

type LoginListener = (user: IdentityUser) => void;
const _loginListeners: LoginListener[] = [];

/** Subscribe to login events. Returns an unsubscribe function. */
export function onLogin(listener: LoginListener): () => void {
    _loginListeners.push(listener);
    return () => {
        const idx = _loginListeners.indexOf(listener);
        if (idx >= 0) _loginListeners.splice(idx, 1);
    };
}

function _notifyLogin(user: IdentityUser) {
    _loginListeners.forEach(fn => fn(user));
}

/**
 * Inject a spam warning banner into the Netlify Identity widget modal.
 * The widget renders into a container with class "netlifyIdentityButton" or
 * creates an iframe. We watch for the modal to appear and prepend our notice.
 */
/**
 * Show a fixed banner above the Identity widget iframe.
 * The widget renders inside an iframe we can't modify, so we overlay our own notice.
 */
function showSpamNotice() {
    const NOTICE_ID = 'pictos-identity-notice';
    if (document.getElementById(NOTICE_ID)) return;

    const notice = document.createElement('div');
    notice.id = NOTICE_ID;
    notice.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
        background: #fef3c7; border-bottom: 2px solid #f59e0b;
        padding: 12px 20px; font-size: 13px; color: #92400e;
        line-height: 1.5; text-align: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    `;
    notice.innerHTML = `
        <strong>Importante:</strong> Si creas una cuenta con correo,
        recibiras un email de <code style="background:#fde68a;padding:2px 5px;border-radius:3px;">no-reply@netlify.com</code>
        para confirmar. <strong>Revisa tu carpeta de SPAM.</strong>
        &mdash; Recomendamos usar <strong>Iniciar sesion con Google</strong>.
    `;
    document.body.appendChild(notice);
}

function removeSpamNotice() {
    document.getElementById('pictos-identity-notice')?.remove();
}

/**
 * Open login and return a Promise that resolves with the user once they log in.
 * Rejects cleanly if the user closes the dialog without logging in.
 */
export function requestLogin(): Promise<IdentityUser> {
    return new Promise(async (resolve, reject) => {
        const widget = await ensureWidget();
        const current = widget.currentUser();
        if (current) { resolve(current); return; }

        let settled = false;

        const onLoginHandler = (u?: IdentityUser) => {
            if (settled) return;
            settled = true;
            removeSpamNotice();
            if (u) resolve(u);
            else reject(new Error('Login cancelled'));
        };

        const onCloseHandler = () => {
            if (settled) return;
            settled = true;
            removeSpamNotice();
            reject(new Error('Login cancelled'));
        };

        widget.on('login', onLoginHandler);
        widget.on('close', onCloseHandler);
        showSpamNotice();
        widget.open('login');
    });
}

/**
 * Garantiza que haya una sesión activa antes de llamar a la API.
 * - En dev: no-op (siempre pasa).
 * - En prod: si no hay sesión, abre el widget y espera login.
 *   Lanza error si el usuario cancela — el caller debe manejar el catch.
 */
export async function ensureAuth(): Promise<void> {
    if (isDev) return;
    await requestLogin();
}

interface AuthProviderProps {
    children: React.ReactNode;
    onUserChange?: (user: IdentityUser | null) => void;
}

/**
 * AuthProvider — initializes the Identity widget in the background.
 * Does NOT block rendering. The app is always accessible.
 */
export const AuthProvider: React.FC<AuthProviderProps> = ({ children, onUserChange }) => {
    useEffect(() => {
        if (isDev) return;

        ensureWidget().then(widget => {
            // Notify parent of initial state
            const current = normalizeUser(widget.currentUser());
            onUserChange?.(current);

            widget.on('login', (u) => {
                widget.close();
                const normalized = normalizeUser(u ?? null);
                onUserChange?.(normalized);
                if (normalized) _notifyLogin(normalized);
            });
            widget.on('logout', () => {
                onUserChange?.(null);
            });
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return <>{children}</>;
};
