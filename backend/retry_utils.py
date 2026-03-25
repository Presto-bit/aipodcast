def retry_target_schedule(initial_target: int):
    """
    统一重试降档策略。
    """
    return [
        int(initial_target),
        min(int(initial_target), 2200),
        min(int(initial_target), 1800),
        min(int(initial_target), 1500),
        min(int(initial_target), 1200),
    ]
