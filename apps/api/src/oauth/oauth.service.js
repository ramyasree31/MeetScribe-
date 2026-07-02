var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
import { Injectable, BadRequestException } from '@nestjs/common';
import { storeGoogleToken, createCalendarWatch } from '@meetscribe/google-client';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
let OauthService = (() => {
    let _classDecorators = [Injectable()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var OauthService = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            OauthService = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        getGoogleAuthUrl(supabaseId) {
            const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
            const redirectUri = `${process.env.PUBLIC_API_URL || 'http://localhost:3000'}/api/oauth/google/callback`;
            const options = {
                redirect_uri: redirectUri,
                client_id: process.env.GOOGLE_CLIENT_ID || '',
                access_type: 'offline',
                prompt: 'consent',
                response_type: 'code',
                state: supabaseId,
                scope: [
                    'openid',
                    'email',
                    'profile',
                    'https://www.googleapis.com/auth/calendar.readonly'
                ].join(' '),
            };
            const qs = new URLSearchParams(options);
            return `${rootUrl}?${qs.toString()}`;
        }
        async handleGoogleCallback(code, supabaseId) {
            const user = await prisma.user.findUnique({ where: { supabaseId } });
            if (!user) {
                throw new BadRequestException('User not found in database. Please register first.');
            }
            const tokenUrl = 'https://oauth2.googleapis.com/token';
            const redirectUri = `${process.env.PUBLIC_API_URL || 'http://localhost:3000'}/api/oauth/google/callback`;
            const response = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code,
                    client_id: process.env.GOOGLE_CLIENT_ID,
                    client_secret: process.env.GOOGLE_CLIENT_SECRET,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code',
                }),
            });
            const data = await response.json();
            if (!response.ok || !data.access_token) {
                throw new BadRequestException(`Google OAuth exchange failed: ${data.error_description || data.error || 'unknown'}`);
            }
            // Save tokens in database (encrypted via storeGoogleToken)
            await storeGoogleToken(user.id, data.access_token, data.refresh_token || '', data.expires_in || 3600, data.scope?.split(' ') || ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly']);
            // Set up calendar push subscription
            try {
                await createCalendarWatch(user.id);
            }
            catch (watchErr) {
                console.error(`[OAuth] Failed to set up Calendar Watch for user ${user.id}:`, watchErr);
            }
            return { success: true };
        }
    };
    return OauthService = _classThis;
})();
export { OauthService };
