"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const supabase_auth_guard_1 = require("../auth/supabase-auth.guard");
const prisma = new client_1.PrismaClient();
let UsersController = class UsersController {
    async syncUser(req, body) {
        const supabaseUser = req.supabaseUser;
        const user = await prisma.user.upsert({
            where: { supabaseId: supabaseUser.id },
            update: {
                email: supabaseUser.email,
                name: body.name,
                avatarUrl: body.avatarUrl,
            },
            create: {
                supabaseId: supabaseUser.id,
                email: supabaseUser.email,
                name: body.name,
                avatarUrl: body.avatarUrl,
            },
        });
        return { success: true, user };
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Post)('sync'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "syncUser", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('users'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard)
], UsersController);
//# sourceMappingURL=users.controller.js.map