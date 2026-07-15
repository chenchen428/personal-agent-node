# Personal Agent Workspace

This directory is the customer-owned side of an installed Personal Agent home.
It contains the complete Harness plus files and state created by the user and the
Agent. Core upgrades seed missing Harness files and migrate schemas, but never
replace user content.

The source repository keeps only the seed contract here. Release installation
materializes the declared mutable directories from `registry/delivery.json`.
