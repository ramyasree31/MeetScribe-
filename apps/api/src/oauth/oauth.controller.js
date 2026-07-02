var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
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
import { Controller, Get, BadRequestException } from '@nestjs/common';
let OauthController = (() => {
    let _classDecorators = [Controller('oauth')];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _instanceExtraInitializers = [];
    let _startGoogleAuth_decorators;
    let _googleCallback_decorators;
    var OauthController = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _startGoogleAuth_decorators = [Get('google/start')];
            _googleCallback_decorators = [Get('google/callback')];
            __esDecorate(this, null, _startGoogleAuth_decorators, { kind: "method", name: "startGoogleAuth", static: false, private: false, access: { has: obj => "startGoogleAuth" in obj, get: obj => obj.startGoogleAuth }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _googleCallback_decorators, { kind: "method", name: "googleCallback", static: false, private: false, access: { has: obj => "googleCallback" in obj, get: obj => obj.googleCallback }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            OauthController = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        oauthService = __runInitializers(this, _instanceExtraInitializers);
        constructor(oauthService) {
            this.oauthService = oauthService;
        }
        startGoogleAuth(supabaseId, res) {
            if (!supabaseId) {
                throw new BadRequestException('Missing supabaseId query parameter');
            }
            const url = this.oauthService.getGoogleAuthUrl(supabaseId);
            return res.redirect(url);
        }
        async googleCallback(code, supabaseId, res) {
            if (!code || !supabaseId) {
                throw new BadRequestException('Missing code or state (supabaseId) parameters');
            }
            try {
                await this.oauthService.handleGoogleCallback(code, supabaseId);
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';
                return res.redirect(`${frontendUrl}/dashboard?oauth=success`);
            }
            catch (err) {
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4000';
                return res.redirect(`${frontendUrl}/dashboard?oauth=error&error=${encodeURIComponent(err.message)}`);
            }
        }
    };
    return OauthController = _classThis;
})();
export { OauthController };
