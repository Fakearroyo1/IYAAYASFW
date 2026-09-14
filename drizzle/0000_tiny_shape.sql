CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`description` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `guards` (
	`id` text PRIMARY KEY NOT NULL,
	`valid` integer NOT NULL,
	CONSTRAINT "operation_is_current" CHECK("guards"."valid" = 1)
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`debt` integer DEFAULT 0 NOT NULL,
	`credit` integer DEFAULT 0 NOT NULL,
	`tab_limit` integer DEFAULT 2000 NOT NULL,
	`due_since` integer,
	CONSTRAINT "valid_balances" CHECK("members"."debt" >= 0 AND "members"."credit" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `members_email_unique` ON `members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_user_id_unique` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`qty` integer NOT NULL,
	`price` integer NOT NULL,
	`cost` integer,
	`tax_bp` integer NOT NULL,
	`preorder` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`fingerprint` text NOT NULL,
	`member_id` text,
	`payer` text NOT NULL,
	`method` text NOT NULL,
	`total` integer NOT NULL,
	`tax` integer NOT NULL,
	`cost` integer,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_code_unique` ON `orders` (`code`);--> statement-breakpoint
CREATE INDEX `orders_member_created` ON `orders` (`member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`order_id` text,
	`member_id` text,
	`purpose` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reference` text,
	`verified_by` text,
	`created_at` integer NOT NULL,
	`verified_at` integer,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_status` ON `payments` (`status`);--> statement-breakpoint
CREATE INDEX `payments_member` ON `payments` (`member_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_provider_reference` ON `payments` (`method`,`reference`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`image` text,
	`price` integer,
	`cost` integer,
	`tax_bp` integer,
	`stock` integer DEFAULT 0 NOT NULL,
	`reorder` integer DEFAULT 5 NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`preorder` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "valid_stock" CHECK("products"."stock" >= 0),
	CONSTRAINT "valid_price" CHECK("products"."price" IS NULL OR "products"."price" > 0)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`cashtag` text DEFAULT '' NOT NULL,
	`cash_instructions` text DEFAULT 'Place the exact amount in the snack bar cash box.' NOT NULL,
	`reminder_days` integer DEFAULT 7 NOT NULL
);
