import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/planner.service.js';

// Planner is plan-scoped: a plan groups goals and carries membership (roles).
// The acting user (req.user) drives visibility + role gating in the service.

// ── Plans ───────────────────────────────────────────────────────────────────
export const listPlans = asyncHandler(async (req, res) => {
  const { plans } = await service.listPlans(req.user);
  sendSuccess(res, { plans });
});

export const getPlan = asyncHandler(async (req, res) => {
  const plan = await service.getPlan(req.user, req.params.planId);
  sendSuccess(res, { plan });
});

export const createPlan = asyncHandler(async (req, res) => {
  const plan = await service.createPlan(req.user, req.body || {});
  sendSuccess(res, { plan }, 201);
});

export const updatePlan = asyncHandler(async (req, res) => {
  const plan = await service.updatePlan(req.user, req.params.planId, req.body || {});
  sendSuccess(res, { plan });
});

export const deletePlan = asyncHandler(async (req, res) => {
  const result = await service.deletePlan(req.user, req.params.planId);
  sendSuccess(res, result);
});

// ── Members ──────────────────────────────────────────────────────────────────
export const addMember = asyncHandler(async (req, res) => {
  const plan = await service.addMember(req.user, req.params.planId, req.body || {});
  sendSuccess(res, { plan });
});

export const setMemberRole = asyncHandler(async (req, res) => {
  const plan = await service.setMemberRole(req.user, req.params.planId, req.params.userId, req.body || {});
  sendSuccess(res, { plan });
});

export const removeMember = asyncHandler(async (req, res) => {
  const plan = await service.removeMember(req.user, req.params.planId, req.params.userId);
  sendSuccess(res, { plan });
});

// People the user can share a plan with (their accepted connections).
export const shareCandidates = asyncHandler(async (req, res) => {
  const connections = await service.listShareCandidates(req.user);
  sendSuccess(res, { connections });
});

// ── Goals (plan-scoped) ──────────────────────────────────────────────────────
export const createGoal = asyncHandler(async (req, res) => {
  const goal = await service.createGoal(req.user, req.params.planId, req.body || {});
  sendSuccess(res, { goal }, 201);
});

export const updateGoal = asyncHandler(async (req, res) => {
  const goal = await service.updateGoal(req.user, req.params.goalId, req.body || {});
  sendSuccess(res, { goal });
});

export const removeGoal = asyncHandler(async (req, res) => {
  const result = await service.removeGoal(req.user, req.params.goalId);
  sendSuccess(res, result);
});
