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
import { Controller, Get, Post, Delete, UseGuards, HttpCode, HttpStatus, } from '@nestjs/common';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
let MeetingsController = (() => {
    let _classDecorators = [Controller('meetings'), UseGuards(SupabaseAuthGuard)];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _instanceExtraInitializers = [];
    let _create_decorators;
    let _findAll_decorators;
    let _findOne_decorators;
    let _remove_decorators;
    let _dispatch_decorators;
    var MeetingsController = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _create_decorators = [Post(), HttpCode(HttpStatus.CREATED)];
            _findAll_decorators = [Get()];
            _findOne_decorators = [Get(':id')];
            _remove_decorators = [Delete(':id'), HttpCode(HttpStatus.OK)];
            _dispatch_decorators = [Post(':id/dispatch'), HttpCode(HttpStatus.OK)];
            __esDecorate(this, null, _create_decorators, { kind: "method", name: "create", static: false, private: false, access: { has: obj => "create" in obj, get: obj => obj.create }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _findAll_decorators, { kind: "method", name: "findAll", static: false, private: false, access: { has: obj => "findAll" in obj, get: obj => obj.findAll }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _findOne_decorators, { kind: "method", name: "findOne", static: false, private: false, access: { has: obj => "findOne" in obj, get: obj => obj.findOne }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _remove_decorators, { kind: "method", name: "remove", static: false, private: false, access: { has: obj => "remove" in obj, get: obj => obj.remove }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _dispatch_decorators, { kind: "method", name: "dispatch", static: false, private: false, access: { has: obj => "dispatch" in obj, get: obj => obj.dispatch }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            MeetingsController = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        meetingsService = __runInitializers(this, _instanceExtraInitializers);
        constructor(meetingsService) {
            this.meetingsService = meetingsService;
        }
        /** POST /meetings — schedule a new meeting */
        async create(req, dto) {
            return this.meetingsService.create(req.supabaseUser.id, dto);
        }
        /** GET /meetings — list all meetings for authenticated user */
        async findAll(req) {
            return this.meetingsService.findAll(req.supabaseUser.id);
        }
        /** GET /meetings/:id — get single meeting with full details */
        async findOne(req, id) {
            return this.meetingsService.findOne(id, req.supabaseUser.id);
        }
        /** DELETE /meetings/:id — cancel a scheduled meeting */
        async remove(req, id) {
            return this.meetingsService.remove(id, req.supabaseUser.id);
        }
        /** POST /meetings/:id/dispatch — immediately send bot to a meeting */
        async dispatch(req, id) {
            return this.meetingsService.dispatchBot(id, req.supabaseUser.id);
        }
    };
    return MeetingsController = _classThis;
})();
export { MeetingsController };
