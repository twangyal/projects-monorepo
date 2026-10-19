
// Test-only instrumentation for the pinned research backend. Production code is unchanged.
#[cfg(test)]
mod garment_order_regression {
    use super::*;

    fn faces() -> Matrix3xX<usize> {
        Matrix3xX::from_column_slice(&[0, 1, 2, 0, 2, 3, 2, 1, 4, 2, 4, 5])
    }

    #[test]
    fn canonical_edges_and_neighbors() {
        let rod = Matrix2xX::from_column_slice(&[6, 7]);
        for _ in 0..64 {
            let (edge, neighbors) = compute_edge(&rod, &faces());
            assert_eq!(edge.as_slice(), &[6, 7, 0, 1, 2, 0, 3, 0, 1, 2, 1, 4, 2, 3, 4, 2, 5, 2, 4, 5]);
            assert_eq!(neighbors, vec![vec![], vec![0], vec![0, 1], vec![1], vec![0, 2], vec![2], vec![1], vec![2, 3], vec![3], vec![3]]);
        }
    }

    #[test]
    fn canonical_hinges_and_neighbors() {
        for _ in 0..64 {
            let (hinge, neighbors) = compute_hinge(&faces());
            assert_eq!(hinge.as_slice(), &[2, 0, 1, 3, 1, 2, 0, 4, 4, 2, 1, 5]);
            assert_eq!(neighbors, vec![vec![0, 1], vec![0, 2], vec![2, 3]]);
        }
    }

    #[test]
    fn non_manifold_first_two_faces_and_hinge_exclusion_are_preserved() {
        let face = Matrix3xX::from_column_slice(&[0, 1, 2, 1, 0, 3, 0, 1, 4]);
        let (edge, neighbors) = compute_edge(&Matrix2xX::from_column_slice(&[]), &face);
        let index = edge.column_iter().position(|e| e[0].min(e[1]) == 0 && e[0].max(e[1]) == 1).unwrap();
        assert_eq!(neighbors[index], vec![0, 1]);
        let (hinge, hinge_neighbors) = compute_hinge(&face);
        assert_eq!(hinge.ncols(), 0);
        assert!(hinge_neighbors.is_empty());
    }
}
