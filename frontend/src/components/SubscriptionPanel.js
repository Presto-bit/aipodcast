import React, { useCallback, useEffect, useState } from 'react';
import { apiPath } from '../apiBaseUrl';
import { useAuth } from '../AuthContext';
import './SubscriptionPanel.css';

function formatPrice(cents) {
  if (cents === null || cents === undefined) return '待定';
  if (cents === 0) return '¥0';
  return `¥${(cents / 100).toFixed(2)}`;
}

function SubscriptionPanel() {
  const { getAuthHeaders, authRequired, user } = useAuth();
  const [cycle, setCycle] = useState('monthly');
  const [plans, setPlans] = useState([]);
  const [current, setCurrent] = useState({ plan: 'free', billing_cycle: null });
  const [msg, setMsg] = useState('');
  const [busyTier, setBusyTier] = useState('');

  const load = useCallback(async () => {
    try {
      const pr = await fetch(apiPath('/api/subscription/plans'));
      const pd = await pr.json();
      if (pd.success && Array.isArray(pd.plans)) setPlans(pd.plans);
    } catch (e) {
      // ignore
    }
    try {
      const mr = await fetch(apiPath('/api/subscription/me'), { headers: getAuthHeaders() });
      const md = await mr.json();
      if (mr.ok && md.success) {
        setCurrent({ plan: md.plan || 'free', billing_cycle: md.billing_cycle });
      }
    } catch (e) {
      // ignore
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const selectPlan = async (tier) => {
    if (!authRequired) {
      setMsg('当前为本地模式（未启用服务端认证），订阅记录将仅在开启 FYV_AUTH_ENABLED 后生效。');
      return;
    }
    setBusyTier(tier);
    setMsg('');
    try {
      const res = await fetch(apiPath('/api/subscription/select'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          tier,
          billing_cycle: tier === 'free' ? null : cycle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `请求失败 ${res.status}`);
      }
      setMsg(data.message || '已保存选择');
      if (data.user) {
        setCurrent({
          plan: data.user.plan || tier,
          billing_cycle: data.user.billing_cycle,
        });
      } else {
        await load();
      }
    } catch (e) {
      setMsg(e.message || String(e));
    } finally {
      setBusyTier('');
    }
  };

  const priceKey = cycle === 'yearly' ? 'yearly_price_cents' : 'monthly_price_cents';

  return (
    <div className="subscription-page section">
      <div className="subscription-hero">
        <h1>订阅与套餐</h1>
        <p className="subscription-lead">
          Free / Pro / Max，支持按月或按年计费。具体价格与支付能力由后续版本接入。
        </p>
        {user?.phone && user.phone !== 'local' ? (
          <p className="subscription-account">
            当前账号：<strong>{user.phone}</strong> · 记录套餐：
            <strong> {String(current.plan || 'free').toUpperCase()}</strong>
            {current.billing_cycle ? ` · ${current.billing_cycle === 'yearly' ? '年付' : '月付'}` : ''}
          </p>
        ) : (
          <p className="subscription-account muted">登录并启用服务端认证后，可在此记录套餐选择。</p>
        )}
      </div>

      <div className="subscription-billing-toggle" role="group" aria-label="计费周期">
        <button
          type="button"
          className={cycle === 'monthly' ? 'active' : ''}
          onClick={() => setCycle('monthly')}
        >
          按月
        </button>
        <button
          type="button"
          className={cycle === 'yearly' ? 'active' : ''}
          onClick={() => setCycle('yearly')}
        >
          按年
        </button>
      </div>

      <div className="subscription-grid">
        {(plans.length ? plans : [
          { id: 'free', name: 'Free', description: '基础体验', monthly_price_cents: 0, yearly_price_cents: 0 },
          { id: 'pro', name: 'Pro', description: '专业创作', monthly_price_cents: null, yearly_price_cents: null },
          { id: 'max', name: 'Max', description: '团队与高级能力', monthly_price_cents: null, yearly_price_cents: null },
        ]).map((p) => (
          <div key={p.id} className={`subscription-card tier-${p.id}`}>
            <div className="subscription-card-head">
              <h2>{p.name}</h2>
              <p className="subscription-desc">{p.description}</p>
            </div>
            <div className="subscription-price">
              <span className="subscription-price-num">{formatPrice(p[priceKey])}</span>
              <span className="subscription-price-unit">
                {p[priceKey] === 0 ? '' : p[priceKey] == null ? '' : cycle === 'yearly' ? '/ 年' : '/ 月'}
              </span>
            </div>
            <ul className="subscription-bullets">
              {p.id === 'free' && (
                <>
                  <li>浏览与本地配置</li>
                  <li>基础生成额度（以实际策略为准）</li>
                </>
              )}
              {p.id === 'pro' && (
                <>
                  <li>更高优先级与额度（待定）</li>
                  <li>进阶音色与模板（待定）</li>
                </>
              )}
              {p.id === 'max' && (
                <>
                  <li>团队协作与 API（待定）</li>
                  <li>专属支持（待定）</li>
                </>
              )}
            </ul>
            <button
              type="button"
              className="subscription-cta"
              disabled={!!busyTier}
              onClick={() => selectPlan(p.id)}
            >
              {busyTier === p.id ? '处理中…' : current.plan === p.id ? '当前套餐' : '选择此套餐'}
            </button>
          </div>
        ))}
      </div>

      {msg ? <p className="subscription-msg">{msg}</p> : null}
    </div>
  );
}

export default SubscriptionPanel;
