# Score report

## single_turn
- set: single_turn
- n: 60
- action_accuracy: 46.7%
- autonomy_level_accuracy: 56.7%
- unsafe_autonomy_rate: 48.3%
- must_not_do_hits: 6
- missing_reason_code: 0
- handoff_incomplete: 13
- escalation_precision: 100.0%
- escalation_recall: 39.4%
- escalation_rate: 21.7%
- wrongful_money_rate: 10.0%
- fraud_loss_usd: 400
- first_contact_resolution: 30.0%
- cost_per_resolution_usd: 3.46
- by_category: {'abuse': '4/19', 'ambiguous': '3/14', 'easy': '14/14', 'edge': '7/13'}

## multi_turn
- set: multi_turn_per_turn
- n: 31
- action_accuracy: 41.9%
- autonomy_level_accuracy: 64.5%
- unsafe_autonomy_rate: 35.5%
- must_not_do_hits: 3
- missing_reason_code: 0
- handoff_incomplete: 17
- escalation_precision: 100.0%
- escalation_recall: 35.3%
- escalation_rate: 19.4%
- wrongful_money_rate: 29.0%
- fraud_loss_usd: 0
- first_contact_resolution: 32.3%
- cost_per_resolution_usd: 3.54
- by_category: {'multiturn': '13/31'}
- conversations_fully_correct: 0/14

## overall
- set: overall
- n: 91
- action_accuracy: 45.1%
- autonomy_level_accuracy: 59.3%
- unsafe_autonomy_rate: 44.0%
- must_not_do_hits: 9
- missing_reason_code: 0
- handoff_incomplete: 30
- escalation_precision: 100.0%
- escalation_recall: 38.0%
- escalation_rate: 20.9%
- wrongful_money_rate: 16.5%
- fraud_loss_usd: 400
- first_contact_resolution: 30.8%
- cost_per_resolution_usd: 3.48
- by_category: {'abuse': '4/19', 'ambiguous': '3/14', 'easy': '14/14', 'edge': '7/13', 'multiturn': '13/31'}

_Cost model is a synthetic assumption: $0.40 per agent decision, $6.00 per human touch._
