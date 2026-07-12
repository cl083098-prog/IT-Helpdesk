-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Jul 12, 2026 at 10:56 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `csma_helpdesk`
--

-- --------------------------------------------------------

--
-- Table structure for table `audit_log`
--

CREATE TABLE `audit_log` (
  `id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `user_name` varchar(100) NOT NULL DEFAULT '',
  `user_role` varchar(50) NOT NULL DEFAULT '',
  `module` varchar(80) NOT NULL DEFAULT '',
  `action` varchar(150) NOT NULL DEFAULT '',
  `detail` text DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `status` enum('Success','Failed','Warning') NOT NULL DEFAULT 'Success',
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `audit_log`
--

INSERT INTO `audit_log` (`id`, `user_id`, `user_name`, `user_role`, `module`, `action`, `detail`, `ip_address`, `status`, `created_at`) VALUES
(1, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-11 21:27:27'),
(2, 4, 'Principal Delacruz', 'school_admin', 'Authentication', 'Logged in', 'School Admin account authenticated. Redirected to: SchoolAdmin.html', '::1', 'Success', '2026-07-11 21:28:05'),
(3, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-11 21:28:43'),
(4, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-11 21:36:05'),
(5, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-11 21:37:36'),
(6, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-11 21:39:50'),
(7, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-11 21:43:09'),
(8, 3, 'Alex Rivera', 'requester', 'ServiceRequest', 'Submitted service request', 'Ticket: #SR-0001 — Replacement of Computer | Category: Equipment | Priority: Medium', '::1', 'Success', '2026-07-11 21:43:31'),
(9, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-11 21:43:56'),
(10, 2, 'Maria Santos', 'dept_head', 'ServiceRequest', 'Approved ticket', 'Ticket: #SR-0001 — Replacement of Computer | Requester: Alex Rivera | Approved. Cost estimate: ₱0.00. Routed to IT Admin.', '::1', 'Success', '2026-07-11 21:44:05'),
(11, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-11 21:44:12'),
(12, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-11 21:44:28'),
(13, 1, 'Administrator', 'admin', 'ServiceRequest', 'Marked ticket as Pending Confirmation', 'Ticket: #SR-0001 — Replacement of Computer | Status changed to Pending Confirmation | Confirmation request sent to requester: Alex Rivera', '::1', 'Success', '2026-07-11 21:45:01'),
(14, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-11 21:45:14'),
(15, 3, 'Alex Rivera', 'requester', 'ServiceRequest', 'Confirmed issue resolved', 'Ticket: #SR-0001 — Replacement of Computer | Requester confirmed the issue is resolved. Ticket closed.', '::1', 'Success', '2026-07-11 21:45:28'),
(16, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-11 21:45:42'),
(17, 2, 'Maria Santos', 'requester', 'ServiceRequest', 'Submitted service request', 'Ticket: #SR-0002 — Request for a box of A1 Bond paper | Category: Consumable | Priority: Low', '::1', 'Success', '2026-07-11 21:46:02'),
(18, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-11 21:46:41'),
(19, 1, 'Administrator', 'admin', 'ServiceRequest', 'Marked ticket as Pending Confirmation', 'Ticket: #SR-0002 — Request for a box of A1 Bond paper | Status changed to Pending Confirmation | Confirmation request sent to requester: Maria Santos', '::1', 'Success', '2026-07-11 21:47:12'),
(20, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-11 21:47:22'),
(21, 2, 'Maria Santos', 'requester', 'ServiceRequest', 'Confirmed issue resolved', 'Ticket: #SR-0002 — Request for a box of A1 Bond paper | Requester confirmed the issue is resolved. Ticket closed.', '::1', 'Success', '2026-07-11 21:47:28'),
(22, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-11 21:54:21'),
(23, 2, 'Maria Santos', 'requester', 'ServiceRequest', 'Submitted service request', 'Ticket: #SR-0003 — Installation of Laptop | Category: Equipment | Priority: Medium', '::1', 'Success', '2026-07-11 21:55:32'),
(24, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-11 21:55:53'),
(25, 0, 'IT Admin', 'admin', 'ServiceRequest', 'Deleted ticket', 'Ticket: #SR-0003 — Installation of Laptop | Requester: Maria Santos | Permanently deleted', '::1', 'Success', '2026-07-11 21:56:11'),
(26, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-11 21:56:23'),
(27, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-12 10:47:28'),
(28, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-12 11:01:38'),
(29, 3, 'Alex Rivera', 'requester', 'ServiceRequest', 'Submitted service request', 'Ticket: #SR-0003 — Installation of Computer | Category: Equipment | Priority: Medium', '::1', 'Success', '2026-07-12 11:02:29'),
(30, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-12 11:02:51'),
(31, 2, 'Maria Santos', 'dept_head', 'ServiceRequest', 'Approved ticket', 'Ticket: #SR-0003 — Installation of Computer | Requester: Alex Rivera | Approved. Cost estimate: ₱0.00. Routed to IT Admin.', '::1', 'Success', '2026-07-12 11:03:02'),
(32, 2, 'Maria Santos', 'requester', 'ServiceRequest', 'Submitted service request', 'Ticket: #SR-0005 — Request for a box of A1 Bond paper | Category: Consumable | Priority: Low', '::1', 'Success', '2026-07-12 11:03:36'),
(33, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 11:03:53'),
(34, 1, 'Administrator', 'admin', 'ServiceRequest', 'Marked ticket as Pending Confirmation', 'Ticket: #SR-0003 — Installation of Computer | Status changed to Pending Confirmation | Confirmation request sent to requester: Alex Rivera', '::1', 'Success', '2026-07-12 11:05:15'),
(35, 1, 'Administrator', 'admin', 'ServiceRequest', 'Marked ticket as Pending Confirmation', 'Ticket: #SR-0005 — Request for a box of A1 Bond paper | Status changed to Pending Confirmation | Confirmation request sent to requester: Maria Santos', '::1', 'Success', '2026-07-12 11:05:21'),
(36, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-12 11:06:23'),
(37, 2, 'Maria Santos', 'requester', 'ServiceRequest', 'Confirmed issue resolved', 'Ticket: #SR-0005 — Request for a box of A1 Bond paper | Requester confirmed the issue is resolved. Ticket closed.', '::1', 'Success', '2026-07-12 11:06:44'),
(38, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-12 11:07:00'),
(39, 3, 'Alex Rivera', 'requester', 'ServiceRequest', 'Confirmed issue resolved', 'Ticket: #SR-0003 — Installation of Computer | Requester confirmed the issue is resolved. Ticket closed.', '::1', 'Success', '2026-07-12 11:07:08'),
(40, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-12 15:59:42'),
(41, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-12 16:00:00'),
(42, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 16:00:20'),
(43, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-12 16:02:01'),
(44, 3, 'Alex Rivera', 'requester', 'ServiceRequest', 'Submitted service request', 'Ticket: #SR-0006 — Replacement of Laptop | Category: Equipment | Priority: Medium', '::1', 'Success', '2026-07-12 16:02:51'),
(45, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-12 16:03:10'),
(46, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-12 16:03:25'),
(47, 2, 'Maria Santos', 'dept_head', 'ServiceRequest', 'Approved ticket', 'Ticket: #SR-0006 — Replacement of Laptop | Requester: Alex Rivera | Approved. Cost estimate: ₱0.00. Routed to IT Admin.', '::1', 'Success', '2026-07-12 16:03:53'),
(48, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 16:04:02'),
(49, 1, 'Administrator', 'admin', 'ServiceRequest', 'Marked ticket as Pending Confirmation', 'Ticket: #SR-0006 — Replacement of Laptop | Status changed to Pending Confirmation | Confirmation request sent to requester: Alex Rivera', '::1', 'Success', '2026-07-12 16:05:01'),
(50, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-12 16:05:22'),
(51, 3, 'Alex Rivera', 'requester', 'ServiceRequest', 'Confirmed issue resolved', 'Ticket: #SR-0006 — Replacement of Laptop | Requester confirmed the issue is resolved. Ticket closed.', '::1', 'Success', '2026-07-12 16:06:00'),
(52, 4, 'Principal Delacruz', 'school_admin', 'Authentication', 'Logged in', 'School Admin account authenticated. Redirected to: SchoolAdmin.html', '::1', 'Success', '2026-07-12 16:06:18'),
(53, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-12 16:08:20'),
(54, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-12 16:28:23'),
(55, 3, 'Alex Rivera', 'requester', 'Authentication', 'Logged in', 'Faculty/Staff account authenticated. Redirected to: RequesterDashboard.html', '::1', 'Success', '2026-07-12 16:28:46'),
(56, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 16:29:09'),
(57, 4, 'Principal Delacruz', 'school_admin', 'Authentication', 'Logged in', 'School Admin account authenticated. Redirected to: SchoolAdmin.html', '::1', 'Success', '2026-07-12 16:29:45'),
(58, 2, 'Maria Santos', 'dept_head', 'Authentication', 'Logged in', 'Dept Head account authenticated. Redirected to: DeptHeadDashboard.html', '::1', 'Success', '2026-07-12 16:32:59'),
(59, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 16:33:14'),
(60, 4, 'Principal Delacruz', 'school_admin', 'Authentication', 'Logged in', 'School Admin account authenticated. Redirected to: SchoolAdmin.html', '::1', 'Success', '2026-07-12 16:33:31'),
(61, 4, 'Principal Delacruz', 'school_admin', 'Authentication', 'Logged in', 'School Admin account authenticated. Redirected to: SchoolAdmin.html', '::1', 'Success', '2026-07-12 16:36:02'),
(62, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 16:36:32'),
(63, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 16:40:27'),
(64, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 16:42:31'),
(65, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 16:45:54'),
(66, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 16:48:21'),
(67, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 16:53:10'),
(68, 1, 'Administrator', 'admin', 'Authentication', 'Logged in', 'IT Admin account authenticated. Redirected to: Dashboard.html', '::1', 'Success', '2026-07-12 16:55:36');

-- --------------------------------------------------------

--
-- Table structure for table `departments`
--

CREATE TABLE `departments` (
  `id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `code` varchar(20) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `departments`
--

INSERT INTO `departments` (`id`, `name`, `code`, `is_active`) VALUES
(1, 'IT Department', 'IT', 1),
(2, 'Senior High School', 'SHS', 1),
(3, 'Junior High School', 'JHS', 1),
(4, 'Elementary', 'ELEM', 1),
(5, 'Administration', 'ADM', 1),
(6, 'Finance', 'FIN', 1);

-- --------------------------------------------------------

--
-- Table structure for table `generated_reports`
--

CREATE TABLE `generated_reports` (
  `id` int(11) NOT NULL,
  `generated_by` int(11) NOT NULL,
  `report_name` varchar(200) NOT NULL,
  `report_type` varchar(80) NOT NULL,
  `date_from` date DEFAULT NULL,
  `date_to` date DEFAULT NULL,
  `export_format` varchar(20) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `inventory`
--

CREATE TABLE `inventory` (
  `id` int(11) NOT NULL,
  `name` varchar(150) NOT NULL,
  `type` enum('Equipment','Consumable') NOT NULL,
  `category` varchar(80) DEFAULT NULL,
  `quantity` int(11) NOT NULL DEFAULT 0,
  `price_unit` decimal(10,2) DEFAULT NULL,
  `low_stock_pct` int(11) DEFAULT 20,
  `oversupply_threshold` int(11) DEFAULT 100,
  `department` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `inventory`
--

INSERT INTO `inventory` (`id`, `name`, `type`, `category`, `quantity`, `price_unit`, `low_stock_pct`, `oversupply_threshold`, `department`, `created_at`) VALUES
(1, 'HP LaserJet Toner Cartridge', 'Consumable', 'Printer Supplies', 25, 3200.00, 20, 100, 'IT Department', '2026-07-11 21:17:52'),
(2, 'A4 Bond Paper (Ream)', 'Consumable', 'Paper', 109, 250.00, 20, 500, 'IT Department', '2026-07-11 21:17:52'),
(3, 'USB Flash Drive 32GB', 'Consumable', 'Storage', 40, 350.00, 20, 100, 'IT Department', '2026-07-11 21:17:52'),
(4, 'Wireless Mouse', 'Consumable', 'Peripherals', 15, 450.00, 20, 100, 'IT Department', '2026-07-11 21:17:52'),
(5, 'HDMI Cable 3m', 'Consumable', 'Cables', 30, 180.00, 20, 100, 'IT Department', '2026-07-11 21:17:52'),
(6, 'Projector', 'Equipment', 'Presentation', 8, 25000.00, 25, 20, 'IT Department', '2026-07-11 21:17:52'),
(7, 'Desktop Computer', 'Equipment', 'Computer', 12, 32000.00, 25, 30, 'IT Department', '2026-07-11 21:17:52'),
(8, 'Laptop', 'Equipment', 'Computer', 6, 45000.00, 25, 20, 'IT Department', '2026-07-11 21:17:52'),
(9, 'LaserJet Printer', 'Equipment', 'Printer', 5, 18000.00, 25, 15, 'IT Department', '2026-07-11 21:17:52'),
(10, 'Network Switch (24-port)', 'Equipment', 'Networking', 3, 15000.00, 25, 10, 'IT Department', '2026-07-11 21:17:52');

-- --------------------------------------------------------

--
-- Table structure for table `inventory_allocations`
--

CREATE TABLE `inventory_allocations` (
  `id` int(11) NOT NULL,
  `item_id` int(11) NOT NULL,
  `department` varchar(100) NOT NULL,
  `from_department` varchar(100) DEFAULT NULL,
  `quantity` int(11) NOT NULL,
  `date_allocated` date NOT NULL DEFAULT curdate(),
  `action_type` enum('Allocate','Transfer','Return') NOT NULL DEFAULT 'Allocate',
  `allocated_by` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `inventory_allocations`
--

INSERT INTO `inventory_allocations` (`id`, `item_id`, `department`, `from_department`, `quantity`, `date_allocated`, `action_type`, `allocated_by`) VALUES
(1, 2, 'Senior High School', NULL, 1, '2026-07-11', 'Allocate', 1),
(2, 2, 'Senior High School', NULL, 10, '2026-07-12', 'Allocate', 1);

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `id` int(11) NOT NULL,
  `target_role` varchar(50) DEFAULT NULL,
  `target_user` int(11) DEFAULT NULL,
  `event_type` varchar(50) NOT NULL DEFAULT 'info',
  `title` varchar(150) NOT NULL,
  `description` text DEFAULT NULL,
  `link_url` varchar(255) DEFAULT NULL,
  `ticket_id` int(11) DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `notifications`
--

INSERT INTO `notifications` (`id`, `target_role`, `target_user`, `event_type`, `title`, `description`, `link_url`, `ticket_id`, `is_read`, `created_at`) VALUES
(10, 'requester', 3, 'status_change', 'Ticket #SR-0001 is now Ongoing', 'Your request \"Replacement of Computer\" has been updated to Ongoing by Administrator.', NULL, 1, 1, '2026-07-11 21:44:56'),
(11, 'requester', 3, 'assigned', 'IT Officer assigned to #SR-0001', 'Administrator has been assigned to your request \"Replacement of Computer\".', NULL, 1, 1, '2026-07-11 21:44:56'),
(12, 'admin', 1, 'assigned_to_you', 'Ticket #SR-0001 assigned to you', 'You\'ve been assigned \"Replacement of Computer\".', NULL, 1, 1, '2026-07-11 21:44:56'),
(13, 'requester', 3, 'sla_change', 'SLA updated on #SR-0001', 'The resolution SLA for \"Replacement of Computer\" is now 1 hour(s).', NULL, 1, 1, '2026-07-11 21:44:56'),
(14, 'requester', 3, 'confirmation_needed', 'Please confirm resolution of #SR-0001', 'IT Admin has marked \"Replacement of Computer\" as completed. Please confirm the issue is fully resolved, or re-open the ticket if it\'s not.', NULL, 1, 1, '2026-07-11 21:45:01'),
(18, 'requester', 2, 'status_change', 'Ticket #SR-0002 is now Ongoing', 'Your request \"Request for a box of A1 Bond paper\" has been updated to Ongoing by Administrator.', NULL, 2, 0, '2026-07-11 21:47:07'),
(19, 'requester', 2, 'assigned', 'IT Officer assigned to #SR-0002', 'Administrator has been assigned to your request \"Request for a box of A1 Bond paper\".', NULL, 2, 0, '2026-07-11 21:47:07'),
(20, 'admin', 1, 'assigned_to_you', 'Ticket #SR-0002 assigned to you', 'You\'ve been assigned \"Request for a box of A1 Bond paper\".', NULL, 2, 1, '2026-07-11 21:47:07'),
(21, 'requester', 2, 'confirmation_needed', 'Please confirm resolution of #SR-0002', 'IT Admin has marked \"Request for a box of A1 Bond paper\" as completed. Please confirm the issue is fully resolved, or re-open the ticket if it\'s not.', NULL, 2, 0, '2026-07-11 21:47:12'),
(23, 'requester', 3, 'ticket_submitted', 'Ticket #SR-0003 submitted', 'Your request \"Installation of Computer\" was submitted and is awaiting Department Head approval.', NULL, 4, 1, '2026-07-12 11:02:29'),
(24, 'dept_head', 2, 'approval_needed', 'Approval needed for #SR-0003', 'Alex Rivera submitted \"Installation of Computer\" for your department. Please review and approve.', NULL, 4, 0, '2026-07-12 11:02:29'),
(25, 'requester', 3, 'approval_approved', 'Approval granted for #SR-0003', 'Your Department Head approved \"Installation of Computer\". The ticket is now with the IT Admin.', NULL, 4, 1, '2026-07-12 11:03:02'),
(26, 'admin', NULL, 'ticket_submitted', 'Approved: #SR-0003 ready to work on', '\"Installation of Computer\" was approved by Dept Head', NULL, 4, 1, '2026-07-12 11:03:02'),
(27, 'requester', 2, 'ticket_submitted', 'Ticket #SR-0005 submitted', 'Your request \"Request for a box of A1 Bond paper\" was submitted and routed to the IT Admin.', NULL, 5, 0, '2026-07-12 11:03:36'),
(28, 'admin', NULL, 'ticket_submitted', 'New ticket #SR-0005', 'Maria Santos reported: \"Request for a box of A1 Bond paper\" (Priority: Low)', NULL, 5, 1, '2026-07-12 11:03:36'),
(29, 'requester', 3, 'status_change', 'Ticket #SR-0003 is now Ongoing', 'Your request \"Installation of Computer\" has been updated to Ongoing by Administrator.', NULL, 4, 1, '2026-07-12 11:04:42'),
(30, 'requester', 3, 'assigned', 'IT Officer assigned to #SR-0003', 'Administrator has been assigned to your request \"Installation of Computer\".', NULL, 4, 1, '2026-07-12 11:04:42'),
(31, 'admin', 1, 'assigned_to_you', 'Ticket #SR-0003 assigned to you', 'You\'ve been assigned \"Installation of Computer\".', NULL, 4, 1, '2026-07-12 11:04:42'),
(32, 'requester', 3, 'sla_change', 'SLA updated on #SR-0003', 'The resolution SLA for \"Installation of Computer\" is now 2 hour(s).', NULL, 4, 1, '2026-07-12 11:04:42'),
(33, 'requester', 2, 'status_change', 'Ticket #SR-0005 is now Ongoing', 'Your request \"Request for a box of A1 Bond paper\" has been updated to Ongoing by Administrator.', NULL, 5, 0, '2026-07-12 11:05:03'),
(34, 'requester', 2, 'assigned', 'IT Officer assigned to #SR-0005', 'Administrator has been assigned to your request \"Request for a box of A1 Bond paper\".', NULL, 5, 0, '2026-07-12 11:05:03'),
(35, 'admin', 1, 'assigned_to_you', 'Ticket #SR-0005 assigned to you', 'You\'ve been assigned \"Request for a box of A1 Bond paper\".', NULL, 5, 1, '2026-07-12 11:05:03'),
(36, 'requester', 2, 'sla_change', 'SLA updated on #SR-0005', 'The resolution SLA for \"Request for a box of A1 Bond paper\" is now .5 hour(s).', NULL, 5, 0, '2026-07-12 11:05:03'),
(37, 'requester', 3, 'confirmation_needed', 'Please confirm resolution of #SR-0003', 'IT Admin has marked \"Installation of Computer\" as completed. Please confirm the issue is fully resolved, or re-open the ticket if it\'s not.', NULL, 4, 1, '2026-07-12 11:05:15'),
(38, 'requester', 2, 'confirmation_needed', 'Please confirm resolution of #SR-0005', 'IT Admin has marked \"Request for a box of A1 Bond paper\" as completed. Please confirm the issue is fully resolved, or re-open the ticket if it\'s not.', NULL, 5, 0, '2026-07-12 11:05:21'),
(44, 'requester', 3, 'ticket_submitted', 'Ticket #SR-0006 submitted', 'Your request \"Replacement of Laptop\" was submitted and is awaiting Department Head approval.', NULL, 6, 1, '2026-07-12 16:02:51'),
(45, 'dept_head', 2, 'approval_needed', 'Approval needed for #SR-0006', 'Alex Rivera submitted \"Replacement of Laptop\" for your department. Please review and approve.', NULL, 6, 0, '2026-07-12 16:02:51'),
(48, 'requester', 3, 'approval_approved', 'Approval granted for #SR-0006', 'Your Department Head approved \"Replacement of Laptop\". The ticket is now with the IT Admin.', NULL, 6, 1, '2026-07-12 16:03:53'),
(49, 'admin', NULL, 'ticket_submitted', 'Approved: #SR-0006 ready to work on', '\"Replacement of Laptop\" was approved by Dept Head', NULL, 6, 1, '2026-07-12 16:03:53'),
(50, 'requester', 3, 'sla_change', 'SLA updated on #SR-0006', 'The resolution SLA for \"Replacement of Laptop\" is now 1 hour(s).', NULL, 6, 1, '2026-07-12 16:04:25'),
(51, 'requester', 3, 'reply', 'New reply on #SR-0006', 'Administrator replied: Attending now the ticket.', NULL, 6, 1, '2026-07-12 16:04:26'),
(52, 'requester', 3, 'status_change', 'Ticket #SR-0006 is now Ongoing', 'Your request \"Replacement of Laptop\" has been updated to Ongoing by Administrator.', NULL, 6, 1, '2026-07-12 16:04:34'),
(53, 'requester', 3, 'assigned', 'IT Officer assigned to #SR-0006', 'Administrator has been assigned to your request \"Replacement of Laptop\".', NULL, 6, 1, '2026-07-12 16:04:34'),
(54, 'admin', 1, 'assigned_to_you', 'Ticket #SR-0006 assigned to you', 'You\'ve been assigned \"Replacement of Laptop\".', NULL, 6, 1, '2026-07-12 16:04:34'),
(55, 'requester', 3, 'reply', 'New reply on #SR-0006', 'Administrator replied: Completed the request', NULL, 6, 1, '2026-07-12 16:04:53'),
(56, 'requester', 3, 'confirmation_needed', 'Please confirm resolution of #SR-0006', 'IT Admin has marked \"Replacement of Laptop\" as completed. Please confirm the issue is fully resolved, or re-open the ticket if it\'s not.', NULL, 6, 1, '2026-07-12 16:05:01');

-- --------------------------------------------------------

--
-- Table structure for table `sla_rules`
--

CREATE TABLE `sla_rules` (
  `id` int(11) NOT NULL,
  `category` varchar(50) NOT NULL,
  `request_type` varchar(80) NOT NULL,
  `equipment_keyword` varchar(100) DEFAULT NULL,
  `priority` enum('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
  `response_hours` decimal(6,2) NOT NULL,
  `resolution_hours` decimal(6,2) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `sla_rules`
--

INSERT INTO `sla_rules` (`id`, `category`, `request_type`, `equipment_keyword`, `priority`, `response_hours`, `resolution_hours`) VALUES
(1, 'Equipment', 'Hardware Issue', NULL, 'Medium', 4.00, 24.00),
(2, 'Equipment', 'Hardware Issue', 'Projector', 'High', 2.00, 8.00),
(3, 'Equipment', 'Hardware Issue', 'Computer', 'High', 2.00, 8.00),
(4, 'Equipment', 'Hardware Issue', 'Printer', 'Medium', 4.00, 24.00),
(5, 'Equipment', 'Maintenance', NULL, 'Low', 8.00, 72.00),
(6, 'Equipment', 'Installation', NULL, 'Medium', 4.00, 24.00),
(7, 'Equipment', 'Replacement', NULL, 'Medium', 4.00, 48.00),
(8, 'Consumable', 'Replenishment', NULL, 'Low', 8.00, 48.00),
(9, 'Consumable', 'Refill', NULL, 'Low', 8.00, 48.00),
(10, 'Network', 'Network Issue', NULL, 'High', 1.00, 4.00),
(11, 'Other', 'General Request', NULL, 'Low', 8.00, 72.00);

-- --------------------------------------------------------

--
-- Table structure for table `tickets`
--

CREATE TABLE `tickets` (
  `id` int(11) NOT NULL,
  `ticket_code` varchar(20) NOT NULL,
  `requester_id` int(11) NOT NULL,
  `department_id` int(11) NOT NULL,
  `category` varchar(50) NOT NULL,
  `request_type` varchar(80) NOT NULL,
  `equipment_item` varchar(150) DEFAULT NULL,
  `title` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `location` varchar(200) DEFAULT NULL,
  `preferred_date` date DEFAULT NULL,
  `priority` enum('Low','Medium','High','Critical') NOT NULL DEFAULT 'Low',
  `status` enum('Pending','Ongoing','Pending Confirmation','Completed','Closed','Cancelled') NOT NULL DEFAULT 'Pending',
  `approval_status` enum('Pending Approval','Approved','Rejected','Not Required') NOT NULL DEFAULT 'Not Required',
  `assigned_to` varchar(150) DEFAULT NULL,
  `sla_response_hours` decimal(6,2) DEFAULT NULL,
  `sla_resolution_hours` decimal(6,2) DEFAULT NULL,
  `sla_custom_hours` decimal(6,2) DEFAULT NULL,
  `response_due_at` datetime DEFAULT NULL,
  `resolution_due_at` datetime DEFAULT NULL,
  `sla_extended_reason` varchar(255) DEFAULT NULL,
  `stock_available` tinyint(1) DEFAULT NULL,
  `external_repair` tinyint(1) NOT NULL DEFAULT 0,
  `repair_service_cost` decimal(10,2) DEFAULT NULL,
  `repair_parts_cost` decimal(10,2) DEFAULT NULL,
  `repair_service_fee` decimal(10,2) DEFAULT NULL,
  `repair_total_cost` decimal(10,2) DEFAULT NULL,
  `repair_remarks` text DEFAULT NULL,
  `repair_receipt_path` varchar(255) DEFAULT NULL,
  `consumable_item_id` int(11) DEFAULT NULL,
  `consumable_qty_needed` int(11) DEFAULT NULL,
  `consumable_dept_id` int(11) DEFAULT NULL,
  `stock_deducted` tinyint(1) NOT NULL DEFAULT 0,
  `submitted_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `closed_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `tickets`
--

INSERT INTO `tickets` (`id`, `ticket_code`, `requester_id`, `department_id`, `category`, `request_type`, `equipment_item`, `title`, `description`, `location`, `preferred_date`, `priority`, `status`, `approval_status`, `assigned_to`, `sla_response_hours`, `sla_resolution_hours`, `sla_custom_hours`, `response_due_at`, `resolution_due_at`, `sla_extended_reason`, `stock_available`, `external_repair`, `repair_service_cost`, `repair_parts_cost`, `repair_service_fee`, `repair_total_cost`, `repair_remarks`, `repair_receipt_path`, `consumable_item_id`, `consumable_qty_needed`, `consumable_dept_id`, `stock_deducted`, `submitted_at`, `updated_at`, `closed_at`, `completed_at`) VALUES
(1, 'SR-0001', 3, 2, 'Equipment', 'Installation', 'Desktop Computer', 'Replacement of Computer', 'Replacement of Computer', 'Room 101', '2026-07-11', 'Medium', 'Closed', 'Approved', 'Administrator', 4.00, 1.00, 1.00, '2026-07-11 19:43:31', '2026-07-11 22:43:31', NULL, 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, '2026-07-11 21:43:31', '2026-07-11 21:45:28', '2026-07-11 21:45:28', '2026-07-11 21:45:28'),
(2, 'SR-0002', 2, 2, 'Consumable', 'Refill', 'A4 Bond Paper (Ream)', 'Request for a box of A1 Bond paper', 'Request for a box of A1 Bond paper', 'Room 102', '2026-07-11', 'Low', 'Closed', 'Not Required', 'Administrator', 8.00, 48.00, 48.00, '2026-07-11 23:46:02', '2026-07-13 21:46:02', NULL, 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, 2, 1, 2, 1, '2026-07-11 21:46:02', '2026-07-11 21:47:28', '2026-07-11 21:47:28', '2026-07-11 21:47:28'),
(4, 'SR-0003', 3, 2, 'Equipment', 'Installation', 'Desktop Computer', 'Installation of Computer', 'Installation of Computer', '202', '2026-07-12', 'Medium', 'Closed', 'Approved', 'Administrator', 4.00, 2.00, 2.00, '2026-07-12 09:02:29', '2026-07-12 13:02:29', NULL, 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, '2026-07-12 11:02:29', '2026-07-12 11:07:05', '2026-07-12 11:07:05', '2026-07-12 11:07:05'),
(5, 'SR-0005', 2, 2, 'Consumable', 'Refill', 'A4 Bond Paper (Ream)', 'Request for a box of A1 Bond paper', 'Request for a box of A1 Bond paper', 'Room 301', '2026-07-12', 'Low', 'Closed', 'Not Required', 'Administrator', 8.00, 0.50, 0.50, '2026-07-12 13:03:36', '2026-07-12 11:03:36', NULL, 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, 2, 10, 2, 1, '2026-07-12 11:03:36', '2026-07-12 11:06:43', '2026-07-12 11:06:43', '2026-07-12 11:06:43'),
(6, 'SR-0006', 3, 2, 'Equipment', 'Replacement', 'Laptop', 'Replacement of Laptop', 'Replacement of Laptop', 'Com Lab 03', '2026-07-12', 'Medium', 'Closed', 'Approved', 'Administrator', 4.00, 1.00, 1.00, '2026-07-12 14:02:51', '2026-07-12 17:02:51', NULL, 1, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, '2026-07-12 16:02:51', '2026-07-12 16:06:00', '2026-07-12 16:06:00', '2026-07-12 16:06:00');

-- --------------------------------------------------------

--
-- Table structure for table `ticket_activity`
--

CREATE TABLE `ticket_activity` (
  `id` int(11) NOT NULL,
  `ticket_id` int(11) NOT NULL,
  `author_id` int(11) DEFAULT NULL,
  `author_name` varchar(150) DEFAULT NULL,
  `message` text NOT NULL,
  `message_type` varchar(30) NOT NULL DEFAULT 'reply',
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `ticket_activity`
--

INSERT INTO `ticket_activity` (`id`, `ticket_id`, `author_id`, `author_name`, `message`, `message_type`, `created_at`) VALUES
(1, 1, 3, 'Alex Rivera', 'Service request submitted. Awaiting Department Head approval before routing to IT Admin.', 'reply', '2026-07-11 21:43:31'),
(2, 1, 2, 'Maria Santos', 'Request approved by Department Head.', 'reply', '2026-07-11 21:44:05'),
(3, 1, 1, 'Administrator', 'Status changed to: Ongoing', 'status_change', '2026-07-11 21:44:56'),
(4, 1, 1, 'Administrator', 'IT Admin has marked this ticket as completed. A confirmation request has been sent to the requester to verify the issue is fully resolved.', 'status_change', '2026-07-11 21:45:01'),
(5, 1, 3, 'Alex Rivera', 'Issue confirmed as resolved by user. Ticket closed.', 'system', '2026-07-11 21:45:28'),
(6, 2, 2, 'Maria Santos', 'Service request submitted. Routed directly to IT Admin for action.', 'reply', '2026-07-11 21:46:02'),
(7, 2, 1, 'Administrator', 'Status changed to: Ongoing', 'status_change', '2026-07-11 21:47:07'),
(8, 2, 1, 'Administrator', 'IT Admin has marked this ticket as completed. A confirmation request has been sent to the requester to verify the issue is fully resolved.', 'status_change', '2026-07-11 21:47:12'),
(9, 2, 2, 'Maria Santos', 'Issue confirmed as resolved by user. Ticket closed.', 'system', '2026-07-11 21:47:28'),
(10, 3, 2, 'Maria Santos', 'Service request submitted. Routed directly to IT Admin for action.', 'reply', '2026-07-11 21:55:32'),
(11, 4, 3, 'Alex Rivera', 'Service request submitted. Awaiting Department Head approval before routing to IT Admin.', 'reply', '2026-07-12 11:02:29'),
(12, 4, 2, 'Maria Santos', 'Request approved by Department Head.', 'reply', '2026-07-12 11:03:02'),
(13, 5, 2, 'Maria Santos', 'Service request submitted. Routed directly to IT Admin for action.', 'reply', '2026-07-12 11:03:36'),
(14, 4, 1, 'Administrator', 'Status changed to: Ongoing', 'status_change', '2026-07-12 11:04:42'),
(15, 5, 1, 'Administrator', 'Status changed to: Ongoing', 'status_change', '2026-07-12 11:05:03'),
(16, 4, 1, 'Administrator', 'IT Admin has marked this ticket as completed. A confirmation request has been sent to the requester to verify the issue is fully resolved.', 'status_change', '2026-07-12 11:05:15'),
(17, 5, 1, 'Administrator', 'IT Admin has marked this ticket as completed. A confirmation request has been sent to the requester to verify the issue is fully resolved.', 'status_change', '2026-07-12 11:05:21'),
(18, 5, 2, 'Maria Santos', 'Issue confirmed as resolved by user. Ticket closed.', 'system', '2026-07-12 11:06:44'),
(19, 4, 3, 'Alex Rivera', 'Issue confirmed as resolved by user. Ticket closed.', 'system', '2026-07-12 11:07:05'),
(20, 6, 3, 'Alex Rivera', 'Service request submitted. Awaiting Department Head approval before routing to IT Admin.', 'reply', '2026-07-12 16:02:51'),
(21, 6, 2, 'Maria Santos', 'Request approved by Department Head.', 'reply', '2026-07-12 16:03:53'),
(22, 6, 1, 'Administrator', 'Attending now the ticket.', 'reply', '2026-07-12 16:04:26'),
(23, 6, 1, 'Administrator', 'Status changed to: Ongoing', 'status_change', '2026-07-12 16:04:34'),
(24, 6, 1, 'Administrator', 'Completed the request', 'reply', '2026-07-12 16:04:53'),
(25, 6, 1, 'Administrator', 'IT Admin has marked this ticket as completed. A confirmation request has been sent to the requester to verify the issue is fully resolved.', 'status_change', '2026-07-12 16:05:01'),
(26, 6, 3, 'Alex Rivera', 'Issue confirmed as resolved by user. Ticket closed.', 'system', '2026-07-12 16:06:00');

-- --------------------------------------------------------

--
-- Table structure for table `ticket_approvals`
--

CREATE TABLE `ticket_approvals` (
  `id` int(11) NOT NULL,
  `ticket_id` int(11) NOT NULL,
  `dept_head_id` int(11) NOT NULL,
  `decision` enum('Approved','Rejected') NOT NULL,
  `estimated_cost` decimal(10,2) DEFAULT NULL,
  `rejection_note` text DEFAULT NULL,
  `decided_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `ticket_approvals`
--

INSERT INTO `ticket_approvals` (`id`, `ticket_id`, `dept_head_id`, `decision`, `estimated_cost`, `rejection_note`, `decided_at`) VALUES
(1, 1, 2, '', NULL, NULL, '2026-07-11 21:43:31'),
(2, 1, 2, 'Approved', NULL, NULL, '2026-07-11 21:44:05'),
(3, 4, 2, '', NULL, NULL, '2026-07-12 11:02:29'),
(4, 4, 2, 'Approved', NULL, NULL, '2026-07-12 11:03:02'),
(5, 6, 2, '', NULL, NULL, '2026-07-12 16:02:51'),
(6, 6, 2, 'Approved', NULL, NULL, '2026-07-12 16:03:52');

-- --------------------------------------------------------

--
-- Table structure for table `ticket_attachments`
--

CREATE TABLE `ticket_attachments` (
  `id` int(11) NOT NULL,
  `ticket_id` int(11) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `original_name` varchar(200) DEFAULT NULL,
  `mime_type` varchar(80) DEFAULT NULL,
  `file_size` int(11) DEFAULT NULL,
  `uploaded_by` int(11) DEFAULT NULL,
  `uploaded_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `ticket_attachments`
--

INSERT INTO `ticket_attachments` (`id`, `ticket_id`, `file_path`, `original_name`, `mime_type`, `file_size`, `uploaded_by`, `uploaded_at`) VALUES
(1, 4, 'assets/attachments/ticket_4_1783825349_35d6fb1e.png', '26_06_28_18_37_53.png', 'image/png', 2426875, 3, '2026-07-12 11:02:29'),
(2, 5, 'assets/attachments/ticket_5_1783825416_5e730991.png', '26_06_28_18_37_53.png', 'image/png', 2426875, 2, '2026-07-12 11:03:36'),
(3, 6, 'assets/attachments/ticket_6_1783843371_da62afdb.png', '26_06_28_18_37_53.png', 'image/png', 2426875, 3, '2026-07-12 16:02:51');

-- --------------------------------------------------------

--
-- Table structure for table `ticket_feedback`
--

CREATE TABLE `ticket_feedback` (
  `id` int(11) NOT NULL,
  `ticket_id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `rating` tinyint(4) NOT NULL,
  `comment` text DEFAULT NULL,
  `submitted_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `ticket_feedback`
--

INSERT INTO `ticket_feedback` (`id`, `ticket_id`, `user_id`, `rating`, `comment`, `submitted_at`) VALUES
(1, 1, 3, 4, NULL, '2026-07-11 21:45:30'),
(2, 2, 2, 4, NULL, '2026-07-11 21:47:30'),
(3, 5, 2, 4, NULL, '2026-07-12 11:06:46'),
(4, 4, 3, 2, NULL, '2026-07-12 11:07:10'),
(5, 6, 3, 4, NULL, '2026-07-12 16:06:03');

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `employee_id` varchar(50) DEFAULT NULL,
  `username` varchar(80) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('admin','school_admin','dept_head','requester') NOT NULL,
  `full_name` varchar(150) NOT NULL,
  `email` varchar(150) DEFAULT NULL,
  `department` varchar(100) DEFAULT NULL,
  `department_id` int(11) DEFAULT NULL,
  `status` enum('Active','Inactive') NOT NULL DEFAULT 'Active',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `employee_id`, `username`, `password`, `role`, `full_name`, `email`, `department`, `department_id`, `status`, `is_active`, `created_at`) VALUES
(1, 'CSMA-IT-001', 'admin', '$2y$10$Lv0jKgsqJyVS/qIKkEza.eq/c7Q2TZ3YuK3YnT0.tyOSV.sfxbr.y', 'admin', 'Administrator', 'admin@csma.edu.ph', 'IT Department', 1, 'Active', 1, '2026-07-11 21:25:47'),
(2, 'CSMA-DH-001', 'depthead', '$2y$10$iakzdGasl5yVHOkziZhV1eRsxufaxnh0Npse.NrVHD54GvjfoO8zy', 'dept_head', 'Maria Santos', 'maria.santos@csma.edu.ph', 'Senior High School', 2, 'Active', 1, '2026-07-11 21:25:47'),
(3, 'CSMA-REQ-001', 'requester', '$2y$10$T5U64XPo4R5ppDEnBAGvW.PS.0cUu5.x9Oy7i2BIyARCJ7pC6vA7i', 'requester', 'Alex Rivera', 'alex.rivera@csma.edu.ph', 'Senior High School', 2, 'Active', 1, '2026-07-11 21:25:47'),
(4, 'CSMA-SA-001', 'schooladmin', '$2y$10$xpJnYN2WvYIlgyLuyieZV.ojrGNMbnlRbqwLJtaNKCALu0CepBRwq', 'school_admin', 'Principal Delacruz', 'principal@csma.edu.ph', 'Administration', 5, 'Active', 1, '2026-07-11 21:25:47');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `audit_log`
--
ALTER TABLE `audit_log`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_audit_created` (`created_at`);

--
-- Indexes for table `departments`
--
ALTER TABLE `departments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_dept_name` (`name`);

--
-- Indexes for table `generated_reports`
--
ALTER TABLE `generated_reports`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `inventory`
--
ALTER TABLE `inventory`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_inventory_type` (`type`);

--
-- Indexes for table `inventory_allocations`
--
ALTER TABLE `inventory_allocations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_alloc_item` (`item_id`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_n_target_user` (`target_user`,`is_read`,`created_at`),
  ADD KEY `idx_n_target_role` (`target_role`,`is_read`,`created_at`);

--
-- Indexes for table `sla_rules`
--
ALTER TABLE `sla_rules`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_sla_cat_rt` (`category`,`request_type`);

--
-- Indexes for table `tickets`
--
ALTER TABLE `tickets`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_ticket_code` (`ticket_code`),
  ADD KEY `idx_tickets_requester` (`requester_id`),
  ADD KEY `idx_tickets_dept` (`department_id`),
  ADD KEY `idx_tickets_status` (`status`),
  ADD KEY `idx_tickets_approval` (`approval_status`);

--
-- Indexes for table `ticket_activity`
--
ALTER TABLE `ticket_activity`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_activity_ticket` (`ticket_id`);

--
-- Indexes for table `ticket_approvals`
--
ALTER TABLE `ticket_approvals`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_approvals_ticket` (`ticket_id`);

--
-- Indexes for table `ticket_attachments`
--
ALTER TABLE `ticket_attachments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_att_ticket` (`ticket_id`);

--
-- Indexes for table `ticket_feedback`
--
ALTER TABLE `ticket_feedback`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_feedback_ticket` (`ticket_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_username` (`username`),
  ADD KEY `idx_users_dept` (`department_id`),
  ADD KEY `idx_users_role` (`role`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `audit_log`
--
ALTER TABLE `audit_log`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=69;

--
-- AUTO_INCREMENT for table `departments`
--
ALTER TABLE `departments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `generated_reports`
--
ALTER TABLE `generated_reports`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `inventory`
--
ALTER TABLE `inventory`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `inventory_allocations`
--
ALTER TABLE `inventory_allocations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `notifications`
--
ALTER TABLE `notifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=63;

--
-- AUTO_INCREMENT for table `sla_rules`
--
ALTER TABLE `sla_rules`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

--
-- AUTO_INCREMENT for table `tickets`
--
ALTER TABLE `tickets`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `ticket_activity`
--
ALTER TABLE `ticket_activity`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=27;

--
-- AUTO_INCREMENT for table `ticket_approvals`
--
ALTER TABLE `ticket_approvals`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `ticket_attachments`
--
ALTER TABLE `ticket_attachments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `ticket_feedback`
--
ALTER TABLE `ticket_feedback`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
