import api from './api.js';

// Planner. Goals live inside a plan; each plan carries membership (roles) and is
// visible only to its members. The list endpoint returns plans, each hydrated
// with { role, members, goals (enriched: current_value/progress/status), summary }.

export async function listPlans() {
  const { data } = await api.get('/planner/plans');
  return data.data; // { plans }
}

export async function createPlan(payload) {
  const { data } = await api.post('/planner/plans', payload);
  return data.data.plan;
}

export async function updatePlan(id, payload) {
  const { data } = await api.patch(`/planner/plans/${id}`, payload);
  return data.data.plan;
}

export async function deletePlan(id) {
  const { data } = await api.delete(`/planner/plans/${id}`);
  return data.data;
}

// ── Members ─────────────────────────────────────────────────────────────────
export async function addMember(planId, payload) {
  const { data } = await api.post(`/planner/plans/${planId}/members`, payload);
  return data.data.plan;
}

export async function setMemberRole(planId, userId, role) {
  const { data } = await api.patch(`/planner/plans/${planId}/members/${userId}`, { role });
  return data.data.plan;
}

export async function removeMember(planId, userId) {
  const { data } = await api.delete(`/planner/plans/${planId}/members/${userId}`);
  return data.data.plan;
}

// Accepted connections the current user can share a plan with.
export async function listConnections() {
  const { data } = await api.get('/planner/connections');
  return data.data.connections;
}

// ── Goals (scoped to a plan) ─────────────────────────────────────────────────
export async function createGoal(planId, payload) {
  const { data } = await api.post(`/planner/plans/${planId}/goals`, payload);
  return data.data.goal;
}

export async function updateGoal(id, payload) {
  const { data } = await api.patch(`/planner/goals/${id}`, payload);
  return data.data.goal;
}

export async function removeGoal(id) {
  const { data } = await api.delete(`/planner/goals/${id}`);
  return data.data;
}
