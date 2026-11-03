# Score report

## single_turn
- set: single_turn
- n: 63
- action_accuracy: 60.3%
- autonomy_level_accuracy: 65.1%
- unsafe_autonomy_rate: 39.7%
- must_not_do_hits: 9
- missing_reason_code: 0
- handoff_incomplete: 23
- escalation_precision: 87.0%
- escalation_recall: 60.6%
- escalation_rate: 36.5%
- wrongful_money_rate: 9.5%
- wrongful_flag_or_deny: 0
- injection_false_positive_rate: 100.0%
- fraud_loss_usd: 400
- first_contact_resolution: 33.3%
- cost_per_resolution_usd: 4.05
- by_category: {'abuse': '11/19', 'ambiguous': '6/14', 'benign_lookalike': '0/3', 'easy': '14/14', 'edge': '7/13'}

## multi_turn
- set: multi_turn_per_turn
- n: 31
- action_accuracy: 51.6%
- autonomy_level_accuracy: 64.5%
- unsafe_autonomy_rate: 32.3%
- must_not_do_hits: 4
- missing_reason_code: 0
- handoff_incomplete: 17
- escalation_precision: 100.0%
- escalation_recall: 41.2%
- escalation_rate: 22.6%
- wrongful_money_rate: 35.5%
- wrongful_flag_or_deny: 0
- injection_false_positive_rate: 0.0%
- fraud_loss_usd: 0
- first_contact_resolution: 38.7%
- cost_per_resolution_usd: 3.23
- by_category: {'multiturn': '16/31'}
- conversations_fully_correct: 1/14

## overall
- set: overall
- n: 94
- action_accuracy: 57.4%
- autonomy_level_accuracy: 64.9%
- unsafe_autonomy_rate: 37.2%
- must_not_do_hits: 13
- missing_reason_code: 0
- handoff_incomplete: 40
- escalation_precision: 90.0%
- escalation_recall: 54.0%
- escalation_rate: 31.9%
- wrongful_money_rate: 18.1%
- wrongful_flag_or_deny: 0
- injection_false_positive_rate: 100.0%
- fraud_loss_usd: 400
- first_contact_resolution: 35.1%
- cost_per_resolution_usd: 3.81
- by_category: {'abuse': '11/19', 'ambiguous': '6/14', 'benign_lookalike': '0/3', 'easy': '14/14', 'edge': '7/13', 'multiturn': '16/31'}

_Cost model is a synthetic assumption: $0.40 per agent decision, $6.00 per human touch._
