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
exports.SummariesController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const supabase_auth_guard_1 = require("../auth/supabase-auth.guard");
const prisma = new client_1.PrismaClient();
let SummariesController = class SummariesController {
    async getSummary(meetingId) {
        const summary = await prisma.summary.findUnique({
            where: { meetingId },
        });
        if (!summary)
            throw new common_1.NotFoundException('Summary not found');
        return summary;
    }
};
exports.SummariesController = SummariesController;
__decorate([
    (0, common_1.Get)(':meetingId'),
    __param(0, (0, common_1.Param)('meetingId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], SummariesController.prototype, "getSummary", null);
exports.SummariesController = SummariesController = __decorate([
    (0, common_1.Controller)('summaries'),
    (0, common_1.UseGuards)(supabase_auth_guard_1.SupabaseAuthGuard)
], SummariesController);
//# sourceMappingURL=summaries.controller.js.map