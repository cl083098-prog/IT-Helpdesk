<?php
// api/inventory.php
// -----------------------------------------------------------------------------
// Unified inventory endpoint for the IT Helpdesk.
// Usage: ?action=ACTION_NAME  (GET for reads, POST for writes)
//
// Roles:
//   - admin        -> full CRUD
//   - school_admin -> read-only  (write actions return 403)
//   - anyone else  -> 403
//
// Role is supplied by the caller in the JSON body (`user_role`, `user_id`)
// or as a query param (`user_role`).  This matches the existing project's
// pattern (no PHP sessions; sessionStorage on the client).
// -----------------------------------------------------------------------------

require_once 'config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ─── Read parameters (query + JSON body) ─────────────────────────────────────
$body   = json_decode(file_get_contents('php://input'), true) ?: [];
$action = trim($_GET['action'] ?? $body['action'] ?? '');
$role   = trim($_GET['user_role'] ?? $body['user_role'] ?? '');
$uid    = (int)($_GET['user_id']  ?? $body['user_id']  ?? 0);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function jsonOk(array $data = [])   { echo json_encode(['success' => true]  + $data); exit; }
function jsonFail(string $msg, int $code = 400) {
    http_response_code($code);
    echo json_encode(['success' => false, 'message' => $msg]);
    exit;
}

// Write actions require IT Admin.  Read actions allow admin or school_admin.
const WRITE_ACTIONS = [
    'add_item', 'update_item', 'delete_item',
    'add_stock', 'allocate_item', 'transfer_item',
];
const READ_ACTIONS  = [
    'list_items', 'get_summary', 'list_allocations',
    'get_item', 'check_stock',
];

function requireRole(string $role, string $action): void {
    if (in_array($action, WRITE_ACTIONS, true)) {
        if ($role !== 'admin') {
            jsonFail('Forbidden: only IT Administrators can modify inventory.', 403);
        }
    } elseif (in_array($action, READ_ACTIONS, true)) {
        if (!in_array($role, ['admin', 'school_admin'], true)) {
            jsonFail('Forbidden: not authorized to view inventory.', 403);
        }
    } else {
        jsonFail("Unknown action: $action", 400);
    }
}

function computeStatusRow(array $r): string {
    $threshold = ((int)$r['low_stock_pct'] / 100) * (int)$r['oversupply_threshold'];
    if ((int)$r['quantity'] <= $threshold)             return 'Low Stock';
    if ((int)$r['quantity'] >  (int)$r['oversupply_threshold']) return 'Oversupply';
    return 'In Stock';
}

// Audit-log writer (uses the same audit_log table other modules use)
function auditLog(PDO $pdo, int $uid, string $role, string $action, string $detail, string $status = 'Success'): void {
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS audit_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT DEFAULT NULL,
            user_name VARCHAR(100) NOT NULL DEFAULT '',
            user_role VARCHAR(50)  NOT NULL DEFAULT '',
            module VARCHAR(80)     NOT NULL DEFAULT '',
            action VARCHAR(150)    NOT NULL DEFAULT '',
            detail TEXT DEFAULT NULL,
            ip_address VARCHAR(45) DEFAULT NULL,
            status ENUM('Success','Failed','Warning') DEFAULT 'Success',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
        $name = '';
        if ($uid) {
            $s = $pdo->prepare("SELECT full_name FROM users WHERE id=:id");
            $s->execute([':id' => $uid]);
            $name = (string)($s->fetchColumn() ?: '');
        }
        $pdo->prepare(
            "INSERT INTO audit_log
                (user_id,user_name,user_role,module,action,detail,ip_address,status)
             VALUES (:uid,:uname,:urole,'Inventory',:act,:det,:ip,:st)"
        )->execute([
            ':uid' => $uid ?: null, ':uname' => $name, ':urole' => $role,
            ':act' => $action,  ':det' => $detail,
            ':ip'  => $_SERVER['REMOTE_ADDR'] ?? '', ':st' => $status,
        ]);
    } catch (PDOException $e) { /* silent */ }
}

// ─── Dispatch ────────────────────────────────────────────────────────────────
if ($action === '') jsonFail('Missing action.');
requireRole($role, $action);

try {
    switch ($action) {

        // -----------------------------------------------------------------
        // READ: list items with optional tab / search filters
        // -----------------------------------------------------------------
        case 'list_items': {
            $tab    = $_GET['tab']    ?? 'all';                 // all|equipment|consumable
            $search = trim($_GET['search'] ?? '');
            $catF   = trim($_GET['category'] ?? '');
            $stat   = trim($_GET['status']   ?? '');            // In Stock|Low Stock|Oversupply

            $where = []; $params = [];
            if ($tab === 'equipment')  { $where[] = "type='Equipment'"; }
            if ($tab === 'consumable') { $where[] = "type='Consumable'"; }
            if ($search !== '') {
                $where[] = '(name LIKE :s OR category LIKE :s OR department LIKE :s)';
                $params[':s'] = "%$search%";
            }
            if ($catF !== '') { $where[] = 'category = :cat'; $params[':cat'] = $catF; }

            $sql = "SELECT id, name, type, category, quantity, price_unit,
                           (quantity * price_unit) AS total_value,
                           low_stock_pct, oversupply_threshold, department
                    FROM inventory";
            if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
            $sql .= ' ORDER BY type, name';

            $stmt = $pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();

            foreach ($rows as &$r) { $r['status'] = computeStatusRow($r); }

            if ($stat !== '') {
                $rows = array_values(array_filter($rows, fn($r) => $r['status'] === $stat));
            }
            jsonOk(['items' => $rows]);
        }

        // -----------------------------------------------------------------
        // READ: dashboard summary numbers
        // -----------------------------------------------------------------
        case 'get_summary': {
            $rows = $pdo->query("SELECT * FROM inventory")->fetchAll();
            $sum = [
                'total_value' => 0, 'equipment_value' => 0, 'consumable_value' => 0,
                'total_items' => count($rows), 'equipment_count' => 0, 'consumable_count' => 0,
                'total_units' => 0, 'equipment_units' => 0, 'consumable_units' => 0,
                'low_stock' => 0, 'oversupply' => 0,
                'item_types' => 0,
            ];
            $cats = [];
            foreach ($rows as $r) {
                $val = (float)$r['price_unit'] * (int)$r['quantity'];
                $sum['total_value'] += $val;
                $sum['total_units'] += (int)$r['quantity'];
                if ($r['type'] === 'Equipment') {
                    $sum['equipment_value'] += $val;
                    $sum['equipment_units'] += (int)$r['quantity'];
                    $sum['equipment_count']++;
                } else {
                    $sum['consumable_value'] += $val;
                    $sum['consumable_units'] += (int)$r['quantity'];
                    $sum['consumable_count']++;
                }
                $st = computeStatusRow($r);
                if ($st === 'Low Stock')  $sum['low_stock']++;
                if ($st === 'Oversupply') $sum['oversupply']++;
                $cats[$r['category']] = true;
            }
            $sum['item_types'] = count($cats);
            jsonOk(['summary' => $sum]);
        }

        // -----------------------------------------------------------------
        // READ: allocations list
        // -----------------------------------------------------------------
        case 'list_allocations': {
            $sql = "SELECT a.id, a.item_id, a.department, a.quantity,
                           a.date_allocated, a.action_type, a.from_department,
                           i.name AS item_name, i.type
                    FROM inventory_allocations a
                    JOIN inventory i ON i.id = a.item_id
                    ORDER BY a.date_allocated DESC, a.id DESC";
            jsonOk(['allocations' => $pdo->query($sql)->fetchAll()]);
        }

        // -----------------------------------------------------------------
        // READ: single item
        // -----------------------------------------------------------------
        case 'get_item': {
            $id = (int)($_GET['id'] ?? 0);
            if (!$id) jsonFail('Missing item id.');
            $s = $pdo->prepare("SELECT * FROM inventory WHERE id=:id");
            $s->execute([':id' => $id]);
            $item = $s->fetch();
            if (!$item) jsonFail('Item not found.', 404);
            $item['status'] = computeStatusRow($item);
            jsonOk(['item' => $item]);
        }

        // -----------------------------------------------------------------
        // READ: stock check by name (used by SLA logic in submit_ticket.php,
        //       also usable by the requester form for real-time hints)
        // -----------------------------------------------------------------
        case 'check_stock': {
            $q = trim($_GET['equipment'] ?? $_GET['name'] ?? '');
            if ($q === '') jsonFail('Missing equipment name.');
            $s = $pdo->prepare(
                "SELECT id, name, type, quantity, low_stock_pct, oversupply_threshold
                 FROM inventory
                 WHERE :q LIKE CONCAT('%', name, '%') OR name LIKE CONCAT('%', :q2, '%')
                 ORDER BY CHAR_LENGTH(name) DESC LIMIT 1"
            );
            $s->execute([':q' => $q, ':q2' => $q]);
            $item = $s->fetch();
            if (!$item) jsonOk(['found' => false, 'in_stock' => false, 'quantity' => 0]);

            $threshold = ((int)$item['low_stock_pct'] / 100) * (int)$item['oversupply_threshold'];
            $status = (int)$item['quantity'] <= 0 ? 'Out of Stock'
                    : ((int)$item['quantity'] <= $threshold ? 'Low Stock' : 'In Stock');
            jsonOk([
                'found'    => true,
                'in_stock' => (int)$item['quantity'] > 0,
                'quantity' => (int)$item['quantity'],
                'status'   => $status,
                'item'     => $item,
            ]);
        }

        // -----------------------------------------------------------------
        // WRITE: add new item
        // -----------------------------------------------------------------
        case 'add_item': {
            $name = trim($body['name'] ?? '');
            $type = trim($body['type'] ?? '');
            $cat  = trim($body['category'] ?? 'General');
            $qty  = (int)($body['quantity']   ?? 0);
            $price= (float)($body['price_unit'] ?? 0);
            $lowP = (int)($body['low_stock_pct'] ?? 15);
            $over = (int)($body['oversupply_threshold'] ?? 100);
            $dept = trim($body['department'] ?? 'Elementary');

            if ($name === '' || !in_array($type, ['Equipment','Consumable'], true)) {
                jsonFail('Name and valid type (Equipment/Consumable) are required.');
            }
            if ($qty < 0 || $price < 0) jsonFail('Quantity and price must be non-negative.');

            $stmt = $pdo->prepare(
                "INSERT INTO inventory
                   (name,type,category,quantity,price_unit,low_stock_pct,oversupply_threshold,department)
                 VALUES (:n,:t,:c,:q,:p,:l,:o,:d)"
            );
            $stmt->execute([
                ':n'=>$name, ':t'=>$type, ':c'=>$cat, ':q'=>$qty,
                ':p'=>$price, ':l'=>$lowP, ':o'=>$over, ':d'=>$dept,
            ]);
            $newId = (int)$pdo->lastInsertId();
            auditLog($pdo, $uid, $role, 'Added inventory item',
                     "Item #$newId — $name ($type) qty=$qty");
            jsonOk(['id' => $newId]);
        }

        // -----------------------------------------------------------------
        // WRITE: update existing item
        // -----------------------------------------------------------------
        case 'update_item': {
            $id = (int)($body['id'] ?? 0);
            if (!$id) jsonFail('Missing id.');

            // Whitelisted columns only
            $allowed = [
                'name' => 'string', 'type' => 'string', 'category' => 'string',
                'quantity' => 'int', 'price_unit' => 'float',
                'low_stock_pct' => 'int', 'oversupply_threshold' => 'int',
                'department' => 'string',
            ];
            $sets = []; $p = [':id' => $id];
            foreach ($allowed as $col => $t) {
                if (array_key_exists($col, $body)) {
                    $v = $body[$col];
                    if ($t === 'int')   $v = (int)$v;
                    if ($t === 'float') $v = (float)$v;
                    $sets[] = "`$col` = :$col";
                    $p[":$col"] = $v;
                }
            }
            if (!$sets) jsonFail('No fields to update.');

            $sql = "UPDATE inventory SET " . implode(', ', $sets) . " WHERE id=:id";
            $pdo->prepare($sql)->execute($p);
            auditLog($pdo, $uid, $role, 'Updated inventory item',
                     "Item #$id — fields: " . implode(', ', array_keys($body)));
            jsonOk(['id' => $id]);
        }

        // -----------------------------------------------------------------
        // WRITE: delete item
        // -----------------------------------------------------------------
        case 'delete_item': {
            $id = (int)($body['id'] ?? 0);
            if (!$id) jsonFail('Missing id.');

            $s = $pdo->prepare("SELECT name FROM inventory WHERE id=:id");
            $s->execute([':id' => $id]);
            $name = (string)($s->fetchColumn() ?: '');
            if ($name === '') jsonFail('Item not found.', 404);

            $pdo->prepare("DELETE FROM inventory WHERE id=:id")->execute([':id' => $id]);
            auditLog($pdo, $uid, $role, 'Deleted inventory item', "Item #$id — $name");
            jsonOk(['id' => $id]);
        }

        // -----------------------------------------------------------------
        // WRITE: add stock to existing item
        // -----------------------------------------------------------------
        case 'add_stock': {
            $id  = (int)($body['id'] ?? 0);
            $qty = (int)($body['quantity'] ?? 0);
            if (!$id || $qty <= 0) jsonFail('Item id and positive quantity required.');

            $pdo->prepare("UPDATE inventory SET quantity = quantity + :q WHERE id=:id")
                ->execute([':q' => $qty, ':id' => $id]);
            auditLog($pdo, $uid, $role, 'Added stock', "Item #$id — +$qty units");
            jsonOk(['id' => $id, 'added' => $qty]);
        }

        // -----------------------------------------------------------------
        // WRITE: allocate item from inventory to a department
        // -----------------------------------------------------------------
        case 'allocate_item': {
            $id     = (int)($body['item_id'] ?? 0);
            $toDept = trim($body['to_department'] ?? '');
            $qty    = (int)($body['quantity'] ?? 0);
            if (!$id || $toDept === '' || $qty <= 0) {
                jsonFail('item_id, to_department and positive quantity required.');
            }

            $pdo->beginTransaction();
            try {
                $s = $pdo->prepare("SELECT name, quantity FROM inventory WHERE id=:id FOR UPDATE");
                $s->execute([':id' => $id]);
                $row = $s->fetch();
                if (!$row)                        throw new Exception('Item not found.');
                if ((int)$row['quantity'] < $qty) throw new Exception('Insufficient stock in main inventory.');

                $pdo->prepare("UPDATE inventory SET quantity = quantity - :q WHERE id=:id")
                    ->execute([':q' => $qty, ':id' => $id]);

                $pdo->prepare(
                    "INSERT INTO inventory_allocations
                       (item_id, department, quantity, date_allocated, action_type, allocated_by)
                     VALUES (:iid, :dept, :q, CURRENT_DATE, 'Allocate', :uid)"
                )->execute([':iid'=>$id, ':dept'=>$toDept, ':q'=>$qty, ':uid'=>$uid ?: null]);

                $pdo->commit();
                auditLog($pdo, $uid, $role, 'Allocated item',
                         "Item #$id ({$row['name']}) — $qty units to $toDept");
                jsonOk(['message' => 'Allocation recorded.']);
            } catch (Exception $e) {
                $pdo->rollBack();
                jsonFail($e->getMessage());
            }
        }

        // -----------------------------------------------------------------
        // WRITE: transfer allocated item between departments
        // -----------------------------------------------------------------
        case 'transfer_item': {
            $id       = (int)($body['item_id'] ?? 0);
            $fromDept = trim($body['from_department'] ?? '');
            $toDept   = trim($body['to_department']   ?? '');
            $qty      = (int)($body['quantity'] ?? 0);
            if (!$id || $fromDept === '' || $toDept === '' || $qty <= 0) {
                jsonFail('item_id, from_department, to_department and positive quantity required.');
            }
            if ($fromDept === $toDept) jsonFail('Source and destination departments must differ.');

            $pdo->beginTransaction();
            try {
                // Sum currently allocated to source dept
                $s = $pdo->prepare(
                    "SELECT COALESCE(SUM(CASE WHEN action_type='Allocate' THEN quantity
                                              WHEN action_type='Transfer' AND department = :d1 THEN quantity
                                              WHEN action_type='Transfer' AND from_department = :d2 THEN -quantity
                                              ELSE 0 END), 0) AS held
                     FROM inventory_allocations
                     WHERE item_id = :iid
                       AND (department = :d3 OR from_department = :d4)"
                );
                $s->execute([':iid'=>$id, ':d1'=>$fromDept, ':d2'=>$fromDept, ':d3'=>$fromDept, ':d4'=>$fromDept]);
                $held = (int)$s->fetchColumn();

                if ($held < $qty) throw new Exception("Source department only holds $held unit(s).");

                $pdo->prepare(
                    "INSERT INTO inventory_allocations
                       (item_id, department, quantity, date_allocated, action_type, from_department, allocated_by)
                     VALUES (:iid, :toDept, :q, CURRENT_DATE, 'Transfer', :fromDept, :uid)"
                )->execute([
                    ':iid'=>$id, ':toDept'=>$toDept, ':q'=>$qty,
                    ':fromDept'=>$fromDept, ':uid'=>$uid ?: null,
                ]);

                $pdo->commit();
                auditLog($pdo, $uid, $role, 'Transferred item',
                         "Item #$id — $qty units from $fromDept to $toDept");
                jsonOk(['message' => 'Transfer recorded.']);
            } catch (Exception $e) {
                $pdo->rollBack();
                jsonFail($e->getMessage());
            }
        }
    }
} catch (PDOException $e) {
    jsonFail('Database error: ' . $e->getMessage(), 500);
}
